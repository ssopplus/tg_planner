import { and, eq, gte, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { calendarEvents } from '@/lib/db/schema'
import {
  caldavConfig,
  discoverCalendars,
  fetchEvents,
  type CalDavConfig,
} from './caldav'
import { expandOccurrences, parseEvents, type IcsEvent } from './ics'
import { startOfToday } from './format'

/**
 * Синхронизация встреч из Яндекс.Календаря в зеркало `calendar_events`.
 *
 * Горизонт — месяц вперёд от начала текущих суток. Назад не смотрим: прошлые
 * встречи ни уведомить, ни подтвердить нельзя, а хранить их незачем.
 */
const HORIZON_DAYS = 30

/** Экземпляр встречи, как он получился после разворота повторений. */
interface Instance {
  uid: string
  startsAt: Date
  endsAt: Date
  allDay: boolean
  summary: string
  location: string | null
  description: string | null
  organizer: string | null
  status: string
  partstat: string
  href: string
  etag: string | null
}

/** Встреча в том виде, в каком о ней говорят пользователю. */
export interface MeetingNotice {
  id: string
  summary: string
  startsAt: Date
  endsAt: Date
  allDay: boolean
  location: string | null
  organizer: string | null
  partstat: string
  /** Есть ли на что отвечать: меня позвали, а не я сам создал встречу. */
  canRespond: boolean
}

export interface CalendarSyncResult {
  calendars: number
  instances: number
  invited: MeetingNotice[]
  moved: Array<{ meeting: MeetingNotice; previousStart: Date }>
  cancelled: MeetingNotice[]
  firstSync: boolean
}

/** Мой ответ на встречу: ищем себя среди участников. */
function myPartstat(event: IcsEvent, config: CalDavConfig): { partstat: string; invited: boolean } {
  const me = event.attendees.find((a) => a.email === config.email)
  if (me) return { partstat: me.partstat, invited: true }
  // Своя встреча без списка участников — отвечать не на что и некому.
  return { partstat: 'ACCEPTED', invited: false }
}

function toNotice(
  row: { id: string; summary: string; startsAt: Date; endsAt: Date; allDay: boolean; location: string | null; organizer: string | null; partstat: string },
  canRespond: boolean,
): MeetingNotice {
  return {
    id: row.id,
    summary: row.summary,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    location: row.location,
    organizer: row.organizer,
    partstat: row.partstat,
    canRespond,
  }
}

/**
 * Забирает встречи окна и приводит их к плоскому списку экземпляров.
 *
 * Повторяющаяся встреча разворачивается здесь: сервер отдаёт серию одним
 * объектом с RRULE, а зеркало хранит каждый день отдельно — иначе один
 * отменённый вторник неотличим от отменённой серии.
 */
async function readInstances(
  config: CalDavConfig,
  from: Date,
  to: Date,
): Promise<{ instances: Instance[]; calendars: number; invitedUids: Set<string> }> {
  const calendars = await discoverCalendars(config)
  const instances: Instance[] = []
  const invitedUids = new Set<string>()

  for (const calendar of calendars) {
    const objects = await fetchEvents(config, calendar.href, from, to)
    for (const object of objects) {
      for (const event of parseEvents(object.ics)) {
        const { partstat, invited } = myPartstat(event, config)
        if (invited) invitedUids.add(event.uid)
        for (const slot of expandOccurrences(event, from, to)) {
          instances.push({
            uid: event.uid,
            startsAt: slot.start,
            endsAt: slot.end,
            allDay: event.allDay,
            summary: event.summary,
            location: event.location ?? null,
            description: event.description ?? null,
            organizer: event.organizer?.name ?? event.organizer?.email ?? null,
            status: event.status,
            partstat,
            href: object.href,
            etag: object.etag,
          })
        }
      }
    }
  }

  return { instances, calendars: calendars.length, invitedUids }
}

/**
 * Сверяет календарь с зеркалом и возвращает, о чём надо сказать.
 *
 * Перенос отличается от пары «отмена + приглашение» только по косвенным
 * признакам, поэтому распознаётся узко: у встречи и в зеркале, и в ответе
 * сервера ровно по одному экземпляру, а время разъехалось. Для серий такой
 * вывод был бы гаданием, и они честно приходят как отмена и приглашение.
 */
export async function syncCalendar(args: {
  userId: string
  timezone: string
  now?: Date
}): Promise<CalendarSyncResult | null> {
  const config = caldavConfig()
  if (!config) return null

  const now = args.now ?? new Date()
  const from = startOfToday(args.timezone, now)
  const to = new Date(from.getTime() + HORIZON_DAYS * 86_400_000)

  const { instances, calendars, invitedUids } = await readInstances(config, from, to)

  const existing = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.userId, args.userId), gte(calendarEvents.startsAt, from)))

  const firstSync = existing.length === 0

  const key = (uid: string, start: Date) => `${uid}|${start.toISOString()}`
  const existingByKey = new Map(existing.map((row) => [key(row.uid, row.startsAt), row]))
  const incomingByKey = new Map<string, Instance>()
  for (const instance of instances) {
    // Отменённый экземпляр в зеркале не держим — он приходит как отмена.
    incomingByKey.set(key(instance.uid, instance.startsAt), instance)
  }

  const invited: MeetingNotice[] = []
  const moved: Array<{ meeting: MeetingNotice; previousStart: Date }> = []
  const cancelled: MeetingNotice[] = []

  const matchedExistingIds = new Set<string>()
  const newInstances: Instance[] = []

  for (const [k, instance] of incomingByKey) {
    const row = existingByKey.get(k)
    if (!row) {
      newInstances.push(instance)
      continue
    }
    matchedExistingIds.add(row.id)

    const wasCancelled = row.status === 'CANCELLED'
    await db
      .update(calendarEvents)
      .set({
        endsAt: instance.endsAt,
        allDay: instance.allDay,
        summary: instance.summary,
        location: instance.location,
        description: instance.description,
        organizer: instance.organizer,
        status: instance.status,
        partstat: instance.partstat,
        href: instance.href,
        etag: instance.etag,
      })
      .where(eq(calendarEvents.id, row.id))

    if (instance.status === 'CANCELLED' && !wasCancelled && !firstSync) {
      cancelled.push(toNotice({ ...row, ...instance }, false))
    }
  }

  // Строки, которых в ответе сервера не оказалось: встречу удалили или
  // перенесли. Их же используем как кандидатов на «перенос».
  const vanished = existing.filter((row) => !matchedExistingIds.has(row.id))

  const vanishedByUid = new Map<string, typeof vanished>()
  for (const row of vanished) {
    const list = vanishedByUid.get(row.uid) ?? []
    list.push(row)
    vanishedByUid.set(row.uid, list)
  }
  const newByUid = new Map<string, Instance[]>()
  for (const instance of newInstances) {
    const list = newByUid.get(instance.uid) ?? []
    list.push(instance)
    newByUid.set(instance.uid, list)
  }

  const movedRowIds = new Set<string>()
  const insertedInstances: Instance[] = []

  for (const [uid, fresh] of newByUid) {
    const gone = vanishedByUid.get(uid) ?? []
    if (fresh.length === 1 && gone.length === 1) {
      const instance = fresh[0]
      const row = gone[0]
      movedRowIds.add(row.id)
      await db
        .update(calendarEvents)
        .set({
          startsAt: instance.startsAt,
          endsAt: instance.endsAt,
          allDay: instance.allDay,
          summary: instance.summary,
          location: instance.location,
          description: instance.description,
          organizer: instance.organizer,
          status: instance.status,
          partstat: instance.partstat,
          href: instance.href,
          etag: instance.etag,
          notifiedAt: new Date(),
        })
        .where(eq(calendarEvents.id, row.id))
      if (!firstSync) {
        moved.push({
          meeting: toNotice({ ...row, ...instance }, invitedUids.has(uid)),
          previousStart: row.startsAt,
        })
      }
      continue
    }
    insertedInstances.push(...fresh)
  }

  for (const instance of insertedInstances) {
    const [row] = await db
      .insert(calendarEvents)
      .values({
        userId: args.userId,
        uid: instance.uid,
        startsAt: instance.startsAt,
        endsAt: instance.endsAt,
        allDay: instance.allDay,
        summary: instance.summary,
        location: instance.location,
        description: instance.description,
        organizer: instance.organizer,
        status: instance.status,
        partstat: instance.partstat,
        href: instance.href,
        etag: instance.etag,
        notifiedAt: firstSync ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning()
    if (!row || firstSync) continue
    if (instance.status === 'CANCELLED') continue
    invited.push(toNotice(row, invitedUids.has(instance.uid)))
  }

  // Исчезнувшие и не опознанные как перенос — отмена.
  const toRemove = vanished.filter((row) => !movedRowIds.has(row.id))
  if (toRemove.length > 0) {
    if (!firstSync) {
      cancelled.push(
        ...toRemove
          .filter((row) => row.status !== 'CANCELLED')
          .map((row) => toNotice(row, false)),
      )
    }
    await db.delete(calendarEvents).where(
      inArray(
        calendarEvents.id,
        toRemove.map((row) => row.id),
      ),
    )
  }

  return { calendars, instances: instances.length, invited, moved, cancelled, firstSync }
}

/** Отмечает, что об этих встречах уже написали. */
export async function markNotified(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(calendarEvents)
    .set({ notifiedAt: new Date() })
    .where(inArray(calendarEvents.id, ids))
}
