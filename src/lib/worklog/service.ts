import { db } from '@/lib/db'
import { worklogEntries } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  addWorklog,
  deleteWorklog,
  listMyWorklogsForDay,
  updateWorklog,
} from '@/lib/tracker/client'
import { trackerConfig } from '@/lib/tracker/config'

export interface WorklogRow {
  id: string
  issueKey: string
  issueTitle: string | null
  minutes: number
  comment: string | null
  trackerWorklogId: number | null
  workDate: string
}

/** Норма рабочего дня в минутах — от неё считается остаток на экране «Время». */
export const WORKDAY_MINUTES = 8 * 60

/** Пресеты длительности. Кнопками закрывается почти всё, что списывается руками. */
export const MINUTE_PRESETS = [15, 30, 60, 120, 240]

/** Пресеты комментариев — те же, что бот предлагает для координации. */
export const COMMENT_PRESETS = [
  'Дейли',
  'Обсуждение задачи',
  'Разработка',
  'Правки',
  'Новый функционал',
]

/** Смещение таймзоны пользователя в формате `+03:00`. */
export function tzOffset(timezone: string, when = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(when)
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const offset = name.replace('GMT', '')
  return offset === '' ? '+00:00' : offset
}

/** Сегодняшняя дата в таймзоне пользователя, YYYY-MM-DD. */
export function todayInTz(timezone: string, when = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(when)
}

/**
 * Момент начала работы для новой записи.
 *
 * Трекер относит запись к тому дню, который стоит в `start`, поэтому для
 * прошедших дней ставим середину рабочего дня, а не текущее время: иначе
 * списание «за вчера», сделанное утром, уехало бы на сегодня.
 */
export function worklogStart(day: string, timezone: string): string {
  const offset = tzOffset(timezone)
  const isToday = day === todayInTz(timezone)
  if (!isToday) return `${day}T12:00:00.000${offset}`

  const now = new Date()
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
  return `${day}T${hhmm}:00.000${offset}`
}

/**
 * Записи за день: читаем Трекер и обновляем зеркало в БД.
 *
 * Источник правды — Трекер: там время могли списать из веб-интерфейса или
 * другого клиента. Зеркало нужно, чтобы список задач показывал «сколько уже
 * списано» без отдельного запроса к API на каждую карточку.
 */
export async function syncWorklogDay(args: {
  userId: string
  timezone: string
  day: string
}): Promise<WorklogRow[]> {
  const config = trackerConfig()
  if (!config) return []

  const remote = await listMyWorklogsForDay({
    ...config,
    day: args.day,
    tzOffset: tzOffset(args.timezone),
  })

  // Старое зеркало дня убираем целиком: записи могли удалить в Трекере, и
  // точечная сверка здесь сложнее, чем перезапись маленького набора строк.
  await db
    .delete(worklogEntries)
    .where(and(eq(worklogEntries.userId, args.userId), eq(worklogEntries.workDate, args.day)))

  if (remote.length === 0) return []

  const rows = await db
    .insert(worklogEntries)
    .values(
      remote.map((w) => ({
        userId: args.userId,
        issueKey: w.issueKey,
        minutes: w.minutes,
        comment: w.comment || null,
        trackerWorklogId: w.id,
        workDate: args.day,
      })),
    )
    .returning()

  return rows.map(toRow)
}

/** Записи дня из зеркала, без похода в Трекер. */
export async function readWorklogDay(userId: string, day: string): Promise<WorklogRow[]> {
  const rows = await db
    .select()
    .from(worklogEntries)
    .where(and(eq(worklogEntries.userId, userId), eq(worklogEntries.workDate, day)))
    .orderBy(worklogEntries.createdAt)
  return rows.map(toRow)
}

/** Новое списание: сначала в Трекер, потом в зеркало. */
export async function createWorklog(args: {
  userId: string
  timezone: string
  day: string
  issueKey: string
  issueTitle?: string | null
  minutes: number
  comment: string
}): Promise<{ ok: true; row: WorklogRow } | { ok: false; error: string }> {
  const config = trackerConfig()
  if (!config) return { ok: false, error: 'Трекер не настроен' }
  if (args.minutes <= 0) return { ok: false, error: 'Длительность должна быть больше нуля' }

  const result = await addWorklog({
    ...config,
    issueKey: args.issueKey,
    minutes: args.minutes,
    comment: args.comment,
    start: worklogStart(args.day, args.timezone),
  })
  if (!result.ok) return { ok: false, error: result.reason }

  const [row] = await db
    .insert(worklogEntries)
    .values({
      userId: args.userId,
      issueKey: args.issueKey,
      issueTitle: args.issueTitle ?? null,
      minutes: args.minutes,
      comment: args.comment || null,
      trackerWorklogId: result.worklogId,
      workDate: args.day,
    })
    .returning()

  return { ok: true, row: toRow(row) }
}

/** Правка записи: длительность и комментарий. */
export async function editWorklog(args: {
  userId: string
  id: string
  minutes?: number
  comment?: string
}): Promise<{ ok: true; row: WorklogRow } | { ok: false; error: string }> {
  const config = trackerConfig()
  if (!config) return { ok: false, error: 'Трекер не настроен' }

  const [entry] = await db
    .select()
    .from(worklogEntries)
    .where(and(eq(worklogEntries.id, args.id), eq(worklogEntries.userId, args.userId)))
    .limit(1)
  if (!entry) return { ok: false, error: 'Запись не найдена' }
  if (!entry.trackerWorklogId) return { ok: false, error: 'Записи нет в Трекере' }

  const minutes = args.minutes ?? entry.minutes
  if (minutes <= 0) return { ok: false, error: 'Длительность должна быть больше нуля' }

  const result = await updateWorklog({
    ...config,
    issueKey: entry.issueKey,
    worklogId: entry.trackerWorklogId,
    minutes,
    comment: args.comment,
  })
  if (!result.ok) return { ok: false, error: result.reason }

  const [row] = await db
    .update(worklogEntries)
    .set({ minutes, ...(args.comment !== undefined ? { comment: args.comment || null } : {}) })
    .where(eq(worklogEntries.id, args.id))
    .returning()

  return { ok: true, row: toRow(row) }
}

/** Удаление записи из Трекера и зеркала. */
export async function removeWorklog(args: {
  userId: string
  id: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = trackerConfig()
  if (!config) return { ok: false, error: 'Трекер не настроен' }

  const [entry] = await db
    .select()
    .from(worklogEntries)
    .where(and(eq(worklogEntries.id, args.id), eq(worklogEntries.userId, args.userId)))
    .limit(1)
  if (!entry) return { ok: false, error: 'Запись не найдена' }

  if (entry.trackerWorklogId) {
    const result = await deleteWorklog({
      ...config,
      issueKey: entry.issueKey,
      worklogId: entry.trackerWorklogId,
    })
    // 404 значит, что в Трекере записи уже нет — зеркало всё равно чистим.
    if (!result.ok && !result.reason.includes('404')) {
      return { ok: false, error: result.reason }
    }
  }

  await db.delete(worklogEntries).where(eq(worklogEntries.id, args.id))
  return { ok: true }
}

/** Сумма минут по ключу задачи — для подписи «сколько списано» на карточках. */
export function sumByIssue(rows: WorklogRow[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const row of rows) {
    totals[row.issueKey] = (totals[row.issueKey] ?? 0) + row.minutes
  }
  return totals
}

/** Человеческая длительность: 90 → «1ч 30м», 45 → «45м». */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0м'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}м`
  if (!m) return `${h}ч`
  return `${h}ч ${m}м`
}

function toRow(entry: typeof worklogEntries.$inferSelect): WorklogRow {
  return {
    id: entry.id,
    issueKey: entry.issueKey,
    issueTitle: entry.issueTitle,
    minutes: entry.minutes,
    comment: entry.comment,
    trackerWorklogId: entry.trackerWorklogId,
    workDate: entry.workDate,
  }
}
