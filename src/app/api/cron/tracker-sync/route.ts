import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, projects, users } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import {
  EXTERNAL_SOURCE_TRACKER,
  listMyActiveIssues,
  mapTrackerPriority,
  QUEUE_TO_PROJECT_SLUG,
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
 * Что НЕ делает (отложено на F2 — двусторонняя синхронизация):
 *  - не пушит DONE из tg-planer обратно в YT;
 *  - не закрывает задачи в БД, когда тикет закрыт в YT (просто перестаёт
 *    обновлять; задача в tg-planer переходит в DONE только если её
 *    закрыть руками или через бота).
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

  // Кэш проектов по slug в рамках одного запроса (id + имя для уведомлений)
  const projectBySlug = new Map<string, { id: string; name: string }>()
  async function findProject(
    slug: string,
  ): Promise<{ id: string; name: string } | null> {
    if (projectBySlug.has(slug)) return projectBySlug.get(slug)!
    const [row] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.slug, slug)))
      .limit(1)
    if (row) projectBySlug.set(slug, row)
    return row ?? null
  }

  const summary = { fetched: issues.length, created: 0, updated: 0, skipped: 0 }
  const now = new Date()

  // Новые задачи этого прогона — для уведомления в конце (кроме первого синка).
  const newTasks: NewTaskNotice[] = []

  for (const issue of issues) {
    const slug = QUEUE_TO_PROJECT_SLUG[issue.queue.key]
    if (!slug) {
      summary.skipped++
      continue
    }
    const project = await findProject(slug)
    if (!project) {
      summary.skipped++
      continue
    }
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

  // Уведомляем в личку о новых задачах. На первом синке (первичный импорт)
  // молчим — иначе прилетит пачка «новых» про давно существующие тикеты.
  if (!isFirstSync) {
    await notifyNewTasks(resolvedUser.telegramId, newTasks)
  }

  return NextResponse.json({
    ok: true,
    summary: { ...summary, notified: isFirstSync ? 0 : newTasks.length, firstSync: isFirstSync },
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
    status: 'TODO' as const,
    externalSource: EXTERNAL_SOURCE_TRACKER,
    externalId: issue.key,
    externalSyncedAt: now,
  }
}
