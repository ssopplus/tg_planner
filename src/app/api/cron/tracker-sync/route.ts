import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, projects, users } from '@/lib/db/schema'
import { and, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm'
import {
  EXTERNAL_SOURCE_TRACKER,
  listMyActiveIssues,
  mapTrackerPriority,
  mapTrackerStatus,
  type TrackerIssue,
} from '@/lib/tracker/client'
import { notifyNewTasks, type NewTaskNotice } from '@/bot/services/tracker-notify'

/**
 * Cron endpoint: тянет активные задачи из Yandex Tracker и складывает в БД
 * как задачи tg-planer. Идемпотентен по (user_id, external_source, external_id).
 *
 * Single-user MVP: userId берётся из env TRACKER_SYNC_USER_ID, либо
 * единственный пользователь из БД.
 *
 * Маппинг «очередь → проект» берётся из БД (projects.trackerQueues), куда его
 * заливает `pnpm sync:vault` из frontmatter `tracker_queues` в index.md проекта
 * в Obsidian-vault. Подключение новой очереди = строка в заметке, без деплоя.
 *
 * Трекер считается источником истины для статуса рабочих задач:
 *  - активный тикет → статус по mapTrackerStatus (даже если локально стоял DONE:
 *    значит закрытие не доехало до YT, и честнее показать это, чем молча
 *    расходиться с Трекером);
 *  - тикет исчез из выборки активных → закрываем задачу локально (DONE).
 *
 * Обратная запись (DONE в tg-planer → transition в YT) живёт в
 * src/app/api/tasks/[id]/route.ts через closeIssue().
 */

async function resolveUser(): Promise<{ id: string; telegramId: bigint } | null> {
  const fromEnv = process.env.TRACKER_SYNC_USER_ID
  if (fromEnv) {
    const [row] = await db
      .select({ id: users.id, telegramId: users.telegramId })
      .from(users)
      .where(eq(users.id, fromEnv))
      .limit(1)
    return row ?? null
  }
  const all = await db
    .select({ id: users.id, telegramId: users.telegramId })
    .from(users)
    .limit(2)
  return all.length === 1 ? all[0] : null
}

/**
 * Строит маппинг «ключ очереди Трекера → проект» из projects.trackerQueues.
 *
 * Источник конфига — frontmatter `tracker_queues` в index.md проекта в
 * Obsidian-vault, залитый `pnpm sync:vault`. Один проект может собирать
 * несколько очередей (SwanHellenic: WEBSH + SHWEB).
 *
 * Если одна очередь указана у двух проектов — берём первый и пишем warning:
 * молча раскидывать задачи одной очереди по разным проектам хуже, чем
 * предсказуемо выбрать один и сообщить о конфликте конфига.
 */
async function buildQueueMap(
  userId: string,
): Promise<Map<string, { id: string; name: string }>> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      trackerQueues: projects.trackerQueues,
    })
    .from(projects)
    .where(and(eq(projects.userId, userId), isNotNull(projects.trackerQueues)))

  const map = new Map<string, { id: string; name: string }>()
  for (const row of rows) {
    const queues = Array.isArray(row.trackerQueues) ? row.trackerQueues : []
    for (const raw of queues) {
      const key = String(raw).trim().toUpperCase()
      if (!key) continue
      const existing = map.get(key)
      if (existing) {
        console.warn(
          `tracker-sync: очередь ${key} привязана к нескольким проектам ` +
            `(${existing.name} и ${row.name}) — использую ${existing.name}`,
        )
        continue
      }
      map.set(key, { id: row.id, name: row.name })
    }
  }
  return map
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.YANDEX_TRACKER_TOKEN
  const orgId = process.env.YANDEX_TRACKER_ORG_ID
  if (!token || !orgId) {
    return NextResponse.json({ error: 'tracker not configured' }, { status: 500 })
  }

  const resolvedUser = await resolveUser()
  if (!resolvedUser) {
    return NextResponse.json({ error: 'cannot resolve user' }, { status: 500 })
  }
  const userId: string = resolvedUser.id

  // Подстраховка от массового спама на «первом» синке: если у пользователя
  // ещё нет ни одной задачи из Трекера, значит это первичный импорт (пустая
  // БД / новый юзер) — тогда тихо загружаем всё без уведомлений, иначе
  // прилетит пачка «новых задач» про давно существующие тикеты.
  const [{ count: existingTrackerCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.externalSource, EXTERNAL_SOURCE_TRACKER),
      ),
    )
  const isFirstSync = existingTrackerCount === 0

  // Тянем все активные тикеты (assignee=me, не закрытые).
  // Оптимизация по updatedSince добавим, когда объём станет проблемой —
  // сейчас YT возвращает ≤100 тикетов за ~300мс, cron запускается раз
  // в 30 мин, нагрузки нет.
  const issues = await listMyActiveIssues({ token, orgId })

  // Маппинг «ключ очереди → проект» строится из projects.trackerQueues.
  // Конфиг приходит из Obsidian (frontmatter tracker_queues), поэтому новая
  // очередь подключается правкой заметки, а не кодом.
  const projectByQueue = await buildQueueMap(userId)
  if (projectByQueue.size === 0) {
    return NextResponse.json(
      {
        error: 'no tracker queues configured',
        hint: 'добавь tracker_queues в frontmatter index.md проекта и прогони pnpm sync:vault',
      },
      { status: 500 },
    )
  }

  const summary = { fetched: issues.length, created: 0, updated: 0, skipped: 0 }
  const now = new Date()

  // Новые задачи этого прогона — для уведомления в конце (кроме первого синка).
  const newTasks: NewTaskNotice[] = []

  // Ключи, реально пришедшие из Трекера — база для reconciliation ниже.
  const seenKeys = new Set<string>()

  for (const issue of issues) {
    const project = projectByQueue.get(issue.queue.key)
    if (!project) {
      // Очередь без конфига (например, AIBOT) — не наш поток задач.
      summary.skipped++
      continue
    }
    seenKeys.add(issue.key)
    const projectId = project.id

    const values = buildTaskValues({ issue, userId, projectId, now })

    const [existing] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.externalSource, EXTERNAL_SOURCE_TRACKER),
          eq(tasks.externalId, issue.key),
        ),
      )
      .limit(1)

    if (existing) {
      await db
        .update(tasks)
        .set({
          title: values.title,
          description: values.description,
          priority: values.priority,
          deadlineAt: values.deadlineAt,
          deadlineType: values.deadlineType,
          projectId: values.projectId,
          // Статус тянем из Трекера: он источник истины для рабочих задач.
          // Локальный DONE при активном тикете сбрасывается сознательно —
          // это признак того, что closeIssue не сработал.
          status: values.status,
          externalSyncedAt: now,
        })
        .where(eq(tasks.id, existing.id))
      summary.updated++
    } else {
      const [inserted] = await db.insert(tasks).values(values).returning({ id: tasks.id })
      summary.created++
      newTasks.push({
        taskId: inserted.id,
        title: values.title,
        projectName: project.name,
        deadlineAt: values.deadlineAt,
      })
    }
  }

  // Reconciliation: тикет, который был активным, а теперь не пришёл в выборке,
  // закрыт (или отменён, или снят с меня) в Трекере — закрываем задачу локально.
  //
  // Границы намеренно узкие:
  //  - только очереди из текущего конфига: если очередь убрали из tracker_queues,
  //    её задачи мы больше не опрашиваем, и «отсутствие» ничего не значит;
  //  - только при непустой выборке: пустой ответ API (сбой/протухший токен)
  //    иначе закрыл бы разом все рабочие задачи;
  //  - DONE/ARCHIVED не трогаем — они уже закрыты.
  //
  // ВАЖНО: логика верна только пока синк тянет ВСЕ активные тикеты. Если
  // вернуть оптимизацию `updatedSince`, выборка станет частичной и «пропавшая»
  // задача перестанет означать «закрытая» — reconciliation придётся выключить.
  let closedLocally = 0
  if (issues.length > 0) {
    const activeQueues = [...projectByQueue.keys()]
    const stale = await db
      .select({ id: tasks.id, externalId: tasks.externalId })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.externalSource, EXTERNAL_SOURCE_TRACKER),
          notInArray(tasks.status, ['DONE', 'ARCHIVED']),
          isNotNull(tasks.externalId),
        ),
      )

    const staleIds = stale
      .filter((row) => {
        const key = row.externalId
        if (!key || seenKeys.has(key)) return false
        // "POLAERP-42" → "POLAERP": закрываем только то, что реально опрашивали.
        const queueKey = key.split('-')[0]?.toUpperCase()
        return Boolean(queueKey && activeQueues.includes(queueKey))
      })
      .map((row) => row.id)

    if (staleIds.length > 0) {
      await db
        .update(tasks)
        .set({ status: 'DONE', completedAt: now, externalSyncedAt: now })
        .where(inArray(tasks.id, staleIds))
      closedLocally = staleIds.length
    }
  }

  // Уведомляем в личку о новых задачах. На первом синке (первичный импорт)
  // молчим — иначе прилетит пачка «новых» про давно существующие тикеты.
  if (!isFirstSync) {
    await notifyNewTasks(resolvedUser.telegramId, newTasks)
  }

  return NextResponse.json({
    ok: true,
    summary: {
      ...summary,
      closedLocally,
      queues: [...projectByQueue.keys()],
      notified: isFirstSync ? 0 : newTasks.length,
      firstSync: isFirstSync,
    },
  })
}

function buildTaskValues(args: {
  issue: TrackerIssue
  userId: string
  projectId: string
  now: Date
}) {
  const { issue, userId, projectId, now } = args
  const deadlineAt = issue.deadline ? new Date(`${issue.deadline}T23:59:59`) : null
  return {
    userId,
    projectId,
    title: issue.summary,
    description: issue.description ?? null,
    priority: mapTrackerPriority(issue.priority?.key),
    deadlineAt,
    deadlineType: deadlineAt ? ('HARD' as const) : null,
    // backlog/open/asPlanned → TODO, inProgress/testing/intest → IN_PROGRESS
    status: mapTrackerStatus(issue.status.key),
    externalSource: EXTERNAL_SOURCE_TRACKER,
    externalId: issue.key,
    externalSyncedAt: now,
  }
}
