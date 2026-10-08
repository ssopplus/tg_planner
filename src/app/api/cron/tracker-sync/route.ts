import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, projects, users, trackerQueueLinks } from '@/lib/db/schema'
import { and, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm'
import {
  EXTERNAL_SOURCE_TRACKER,
  getMyUid,
  listComments,
  listMyActiveIssues,
  mapTrackerPriority,
  mapTrackerStatus,
  type TrackerIssue,
} from '@/lib/tracker/client'
import {
  notifyClosedTasks,
  notifyNewTasks,
  notifyTaskChanges,
  type ClosedTaskNotice,
  type CommentNotice,
  type NewTaskNotice,
  type TaskChangeNotice,
} from '@/bot/services/tracker-notify'
import { diffTask } from '@/lib/tracker/changes'
import { resolveProjectForIssue, type QueueLink } from '@/lib/tracker/queue-links'

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
 *
 * Синк же и уведомляет: новая задача, изменение существующей (статус,
 * дедлайн, приоритет, заголовок, описание, чужой комментарий) и закрытие.
 * Комментарии дотягиваются отдельным запросом и только для задач, у которых
 * сдвинулся `updatedAt`, — Трекер двигает его на любую запись в changelog,
 * включая добавление комментария.
 */

/**
 * Предохранитель на добор комментариев: столько задач за прогон мы готовы
 * опросить отдельными запросами. Шевельнуться за полчаса может и сотня
 * тикетов (массовая правка полей роботом очереди), и тогда синк упёрся бы в
 * лимит времени функции.
 */
const MAX_COMMENT_FETCHES = 20

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
 * Загружает связки «очередь → проект» из настроек пользователя.
 * Разбор тикета по ним живёт в src/lib/tracker/queue-links.ts.
 */
async function loadQueueLinks(userId: string): Promise<QueueLink[]> {
  const rows = await db
    .select({
      queueKey: trackerQueueLinks.queueKey,
      titleFilter: trackerQueueLinks.titleFilter,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(trackerQueueLinks)
    .innerJoin(projects, eq(projects.id, trackerQueueLinks.projectId))
    .where(eq(trackerQueueLinks.userId, userId))

  return rows.map((r) => ({
    queueKey: r.queueKey.toUpperCase(),
    titleFilter: r.titleFilter,
    project: { id: r.projectId, name: r.projectName },
  }))
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

  // Связки «очередь → проект» задаются на экране настроек в Mini App.
  const links = await loadQueueLinks(userId)
  if (links.length === 0) {
    return NextResponse.json(
      {
        error: 'no tracker queues configured',
        hint: 'привяжи очереди к проектам в настройках Mini App (раздел «Очереди Трекера»)',
      },
      { status: 500 },
    )
  }
  const linkedQueues = [...new Set(links.map((l) => l.queueKey))]

  const summary = { fetched: issues.length, created: 0, updated: 0, skipped: 0 }
  const now = new Date()

  // Новые задачи этого прогона — для уведомления в конце (кроме первого синка).
  const newTasks: NewTaskNotice[] = []
  // Изменившиеся задачи и те, у кого надо дотянуть комментарии.
  const changed: TaskChangeNotice[] = []
  const commentCandidates: Array<{
    taskId: string
    issueKey: string
    title: string
    lastCommentId: number | null
    since: Date | null
  }> = []

  // Ключи, реально пришедшие из Трекера — база для reconciliation ниже.
  const seenKeys = new Set<string>()

  for (const issue of issues) {
    const project = resolveProjectForIssue(links, issue)
    if (!project) {
      // Очередь не связана ни с одним проектом (например, AIBOT) — не наш поток.
      summary.skipped++
      continue
    }
    seenKeys.add(issue.key)
    const projectId = project.id

    const values = buildTaskValues({ issue, userId, projectId, now })

    const [existing] = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        priority: tasks.priority,
        deadlineAt: tasks.deadlineAt,
        trackerStatus: tasks.trackerStatus,
        trackerUpdatedAt: tasks.trackerUpdatedAt,
        trackerLastCommentId: tasks.trackerLastCommentId,
        externalSyncedAt: tasks.externalSyncedAt,
      })
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
      // Разницу считаем ДО записи: после update старые значения уже не достать.
      const changes = diffTask(
        {
          title: existing.title,
          description: existing.description,
          trackerStatus: existing.trackerStatus,
          priority: existing.priority,
          deadlineAt: existing.deadlineAt,
        },
        {
          title: values.title,
          description: values.description,
          trackerStatus: values.trackerStatus,
          priority: values.priority,
          deadlineAt: values.deadlineAt,
        },
      )
      if (changes.length > 0) {
        changed.push({
          taskId: existing.id,
          issueKey: issue.key,
          title: values.title,
          changes,
          comments: [],
        })
      }

      // `updatedAt` сдвигается на любую запись в changelog, комментарии в том
      // числе. Это и есть дешёвый фильтр: опрашиваем только шевельнувшихся.
      const movedInTracker =
        !existing.trackerUpdatedAt ||
        existing.trackerUpdatedAt.getTime() !== new Date(issue.updatedAt).getTime()
      if (movedInTracker) {
        commentCandidates.push({
          taskId: existing.id,
          issueKey: issue.key,
          title: values.title,
          lastCommentId: existing.trackerLastCommentId,
          since: existing.externalSyncedAt,
        })
      }

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
          trackerStatus: values.trackerStatus,
          trackerUpdatedAt: values.trackerUpdatedAt,
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
  const closedNotices: ClosedTaskNotice[] = []
  if (issues.length > 0) {
    const activeQueues = linkedQueues
    const stale = await db
      .select({ id: tasks.id, externalId: tasks.externalId, title: tasks.title })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.externalSource, EXTERNAL_SOURCE_TRACKER),
          notInArray(tasks.status, ['DONE', 'ARCHIVED']),
          isNotNull(tasks.externalId),
        ),
      )

    const staleRows = stale.filter((row) => {
      const key = row.externalId
      if (!key || seenKeys.has(key)) return false
      // "POLAERP-42" → "POLAERP": закрываем только то, что реально опрашивали.
      const queueKey = key.split('-')[0]?.toUpperCase()
      return Boolean(queueKey && activeQueues.includes(queueKey))
    })
    const staleIds = staleRows.map((row) => row.id)

    if (staleIds.length > 0) {
      await db
        .update(tasks)
        .set({ status: 'DONE', completedAt: now, externalSyncedAt: now })
        .where(inArray(tasks.id, staleIds))
      closedLocally = staleIds.length
      closedNotices.push(
        ...staleRows.map((row) => ({
          taskId: row.id,
          issueKey: row.externalId ?? '',
          title: row.title,
        })),
      )
    }
  }

  // Комментарии — единственное, ради чего синк ходит в Трекер повторно,
  // поэтому и только для шевельнувшихся задач, и под потолком запросов.
  let myUid: string | null = null
  for (const candidate of commentCandidates.slice(0, MAX_COMMENT_FETCHES)) {
    try {
      if (!myUid) myUid = await getMyUid({ token, orgId })
      const comments = await listComments({ token, orgId, issueKey: candidate.issueKey })
      if (comments.length === 0) continue

      const maxId = Math.max(...comments.map((c) => c.id))
      // Базовая линия: если id последнего комментария ещё не запомнен (задача
      // синхронизирована до появления колонки), берём время прошлого синка —
      // иначе первый прогон вывалил бы всю историю обсуждения разом.
      const fresh: CommentNotice[] = comments
        .filter((c) => {
          if (c.createdBy?.id && myUid && c.createdBy.id === myUid) return false
          if (candidate.lastCommentId !== null) return c.id > candidate.lastCommentId
          return candidate.since ? new Date(c.createdAt) > candidate.since : false
        })
        .map((c) => ({ author: c.createdBy?.display ?? 'без автора', text: c.text }))

      await db
        .update(tasks)
        .set({ trackerLastCommentId: maxId })
        .where(eq(tasks.id, candidate.taskId))

      if (fresh.length === 0) continue
      const existingNotice = changed.find((n) => n.taskId === candidate.taskId)
      if (existingNotice) {
        existingNotice.comments = fresh
      } else {
        changed.push({
          taskId: candidate.taskId,
          issueKey: candidate.issueKey,
          title: candidate.title,
          changes: [],
          comments: fresh,
        })
      }
    } catch (error) {
      // Отдельный тикет может быть недоступен (права, удалён) — это не повод
      // ронять весь синк: остальные задачи уже сохранены.
      console.error(`Не удалось прочитать комментарии ${candidate.issueKey}:`, error)
    }
  }

  // Уведомляем в личку о новых задачах. На первом синке (первичный импорт)
  // молчим — иначе прилетит пачка «новых» про давно существующие тикеты.
  if (!isFirstSync) {
    await notifyNewTasks(resolvedUser.telegramId, newTasks)
    await notifyTaskChanges(resolvedUser.telegramId, changed)
    await notifyClosedTasks(resolvedUser.telegramId, closedNotices)
  }

  return NextResponse.json({
    ok: true,
    summary: {
      ...summary,
      closedLocally,
      queues: linkedQueues,
      changed: changed.length,
      commentChecks: Math.min(commentCandidates.length, MAX_COMMENT_FETCHES),
      notified: isFirstSync ? 0 : newTasks.length + changed.length + closedNotices.length,
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
    // Статус словами Трекера нужен уведомлениям: «Можно тестировать →
    // Тестируется» в наших TODO/IN_PROGRESS неразличимо.
    trackerStatus: issue.status.display,
    trackerUpdatedAt: new Date(issue.updatedAt),
    externalSource: EXTERNAL_SOURCE_TRACKER,
    externalId: issue.key,
    externalSyncedAt: now,
  }
}
