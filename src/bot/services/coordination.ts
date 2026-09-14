/**
 * Ежедневный опрос по координации (очередь INTCOORD).
 *
 * Координационная работа — дейли, созвоны, обсуждения — нигде не фиксируется
 * автоматически: в Claude её не видно, коммитов она не оставляет, а в норму
 * рабочего дня входит. Поэтому по будням бот спрашивает о ней сам и списывает
 * ответ в Трекер через учёт времени.
 *
 * Опрос идёт поштучно: одно сообщение редактируется на каждом шаге, кнопки —
 * готовые интервалы. Состояние между нажатиями лежит в `coordination_polls`
 * (в `callback_data` его не унести — там 64 байта).
 *
 * Записывать умеет только в INTCOORD: списание рабочих задач остаётся ручным,
 * как и в скилле /timesheet.
 */
import { InlineKeyboard } from 'grammy'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { coordinationPolls, users } from '@/lib/db/schema'
import { addWorklog, listMyWorklogsForDay } from '@/lib/tracker/client'

/** Единственная очередь, в которую боту разрешено писать время. */
export const COORDINATION_QUEUE = 'INTCOORD'

export interface Direction {
  key: string
  /** Короткое имя для сообщения — полные summary в очереди длинные. */
  label: string
  /** Медиана за наблюдаемый период: подсказка в вопросе, не значение по умолчанию. */
  usual: number
  /** Комментарий к записи в Трекере. */
  comment: string
}

/**
 * Регулярные направления — те, что случаются почти каждый будний день.
 * Остальные (ВодоходЪ, ЦСБ, свои продукты, DevOps) бывают по поводу и
 * добавляются в опрос кнопкой «ещё направление».
 */
export const REGULAR_DIRECTIONS: Direction[] = [
  { key: 'INTCOORD-1', label: 'Общий дейли', usual: 30, comment: 'Общий дейли' },
  { key: 'INTCOORD-3', label: 'Swan Hellenic', usual: 15, comment: 'Дейли' },
  { key: 'INTCOORD-4', label: 'ПолаРайз', usual: 30, comment: 'Дейли' },
  { key: 'INTCOORD-7', label: 'Revenue Radar', usual: 15, comment: 'Дейли' },
]

/** Нерегулярные направления той же очереди — по запросу. */
export const EXTRA_DIRECTIONS: Direction[] = [
  { key: 'INTCOORD-2', label: 'ВодоходЪ', usual: 30, comment: 'Созвон' },
  { key: 'INTCOORD-5', label: 'ЦСБ / Малый флот', usual: 30, comment: 'Созвон' },
  { key: 'INTCOORD-6', label: 'Свои продукты', usual: 30, comment: 'Созвон' },
  { key: 'INTCOORD-8', label: 'DevOps', usual: 30, comment: 'Созвон' },
]

export const ALL_DIRECTIONS = [...REGULAR_DIRECTIONS, ...EXTRA_DIRECTIONS]

export function findDirection(key: string): Direction | undefined {
  return ALL_DIRECTIONS.find((d) => d.key === key)
}

/** Минуты → «1ч15м» / «45м». */
export function formatMinutes(min: number): string {
  if (min <= 0) return '0м'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (!h) return `${m}м`
  return m ? `${h}ч${String(m).padStart(2, '0')}м` : `${h}ч`
}

/** Варианты ответа на шаге. Ноль — «сегодня этого не было». */
const MINUTE_CHOICES = [0, 15, 30, 45, 60, 90]

/** Сегодняшняя дата (YYYY-MM-DD) в таймзоне пользователя. */
export function todayInTz(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Будний ли день (пн–пт) в таймзоне пользователя. */
export function isWeekday(timezone: string, now = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(now)
  return !['Sat', 'Sun'].includes(weekday)
}

/**
 * Смещение таймзоны в формате `+03:00` на конкретный момент.
 * Считается через `Intl`, поэтому переход на летнее время учитывается сам.
 */
export function tzOffset(timezone: string, at = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(at)
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const m = /GMT([+-]\d{2}:\d{2})/.exec(name)
  return m ? m[1] : '+00:00'
}

export type PollRow = typeof coordinationPolls.$inferSelect
export type UserRow = typeof users.$inferSelect

/** Текст сообщения и клавиатура для текущего состояния опроса. */
export function renderPoll(poll: PollRow): { text: string; keyboard: InlineKeyboard } {
  const answered = Object.entries(poll.answers)
  const total = answered.reduce((sum, [, min]) => sum + min, 0)
  const day = formatPollDate(poll.pollDate)

  const lines: string[] = [`⏱ Координация за ${day}`, '']
  for (const [key, min] of answered) {
    const dir = findDirection(key)
    lines.push(`${min > 0 ? '•' : '○'} ${dir?.label ?? key} — ${formatMinutes(min)}`)
  }

  if (poll.status === 'asking') {
    const current = poll.steps[poll.step]
    const dir = findDirection(current)
    if (answered.length) lines.push('')
    lines.push(`❓ ${dir?.label ?? current} — сколько сегодня?`)
    if (dir) lines.push(`обычно ${formatMinutes(dir.usual)}`)

    const kb = new InlineKeyboard()
    MINUTE_CHOICES.forEach((min, i) => {
      // Перенос строки ставим ПЕРЕД кнопкой, иначе после последней в ряду
      // остаётся пустой ряд — Telegram рисует его как щель под клавиатурой.
      if (i > 0 && i % 3 === 0) kb.row()
      kb.text(min === 0 ? 'не было' : formatMinutes(min), `coord:set:${min}`)
    })
    kb.row()
    if (poll.step > 0) kb.text('↩︎ Назад', 'coord:back')
    kb.text('⏭ Пропустить день', 'coord:skipday')
    return { text: lines.join('\n'), keyboard: kb }
  }

  if (poll.status === 'confirming') {
    lines.push('', `Итого: ${formatMinutes(total)}`)
    const kb = new InlineKeyboard()
      .text('✅ Списать в Трекер', 'coord:submit')
      .row()
      .text('➕ Ещё направление', 'coord:more')
      .row()
      .text('✏️ Заново', 'coord:restart')
    return { text: lines.join('\n'), keyboard: kb }
  }

  if (poll.status === 'skipped') {
    return { text: `⏱ Координация за ${day}\n\nПропущено — ничего не списано.`, keyboard: new InlineKeyboard() }
  }

  // submitted
  const written = Object.keys(poll.worklogIds).length
  lines.push('', `✅ Списано в Трекер: ${formatMinutes(total)} (${pluralRecords(written)})`)
  return { text: lines.join('\n'), keyboard: new InlineKeyboard() }
}

/** «1 запись» / «2 записи» / «5 записей». */
function pluralRecords(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} запись`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} записи`
  return `${n} записей`
}

/** `2026-09-11` → `11.09 (пт)`. */
export function formatPollDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getUTCDay()]
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}.${mm} (${wd})`
}

/**
 * Заводит (или возвращает существующий) опрос за сегодня.
 *
 * Направления, по которым за этот день уже есть запись в Трекере, из опроса
 * убираются: скилл /timesheet пишет в ту же очередь, и спрашивать второй раз
 * значило бы задвоить часы.
 */
export async function ensureTodayPoll(
  user: UserRow,
  opts: { token: string; orgId: string },
): Promise<{ poll: PollRow; alreadyLogged: Record<string, number> } | null> {
  const day = todayInTz(user.timezone)

  const [existing] = await db
    .select()
    .from(coordinationPolls)
    .where(and(eq(coordinationPolls.userId, user.id), eq(coordinationPolls.pollDate, day)))
  if (existing) return { poll: existing, alreadyLogged: {} }

  const logged = await listMyWorklogsForDay({
    token: opts.token,
    orgId: opts.orgId,
    queuePrefix: COORDINATION_QUEUE,
    day,
    tzOffset: tzOffset(user.timezone),
  })
  const alreadyLogged: Record<string, number> = {}
  for (const w of logged) {
    alreadyLogged[w.issueKey] = (alreadyLogged[w.issueKey] ?? 0) + w.minutes
  }

  const steps = REGULAR_DIRECTIONS.map((d) => d.key).filter((k) => !(k in alreadyLogged))
  if (steps.length === 0) return null

  const [poll] = await db
    .insert(coordinationPolls)
    .values({ userId: user.id, pollDate: day, steps, step: 0, status: 'asking' })
    .returning()
  return { poll, alreadyLogged }
}

/**
 * Пишет ответы опроса в Трекер.
 *
 * Направления с нулём пропускаются — нулевой ворклог не несёт информации.
 * Время начала ставится на 12:00 дня опроса: Трекер относит запись к дню из
 * `start`, а не к моменту запроса, поэтому поздний вечерний ответ всё равно
 * попадает в нужный день.
 */
export async function submitPoll(
  poll: PollRow,
  user: UserRow,
  opts: { token: string; orgId: string },
): Promise<{ worklogIds: Record<string, number>; failed: Array<{ key: string; reason: string }> }> {
  const start = `${poll.pollDate}T12:00:00.000${tzOffset(user.timezone, new Date(`${poll.pollDate}T12:00:00Z`))}`

  const worklogIds: Record<string, number> = {}
  const failed: Array<{ key: string; reason: string }> = []

  for (const [key, minutes] of Object.entries(poll.answers)) {
    if (minutes <= 0) continue
    const dir = findDirection(key)
    if (!key.startsWith(`${COORDINATION_QUEUE}-`)) {
      failed.push({ key, reason: 'не очередь координации' })
      continue
    }
    const res = await addWorklog({
      token: opts.token,
      orgId: opts.orgId,
      issueKey: key,
      minutes,
      comment: dir?.comment ?? 'Координация',
      start,
    })
    if (res.ok) worklogIds[key] = res.worklogId
    else failed.push({ key, reason: res.reason })
  }

  return { worklogIds, failed }
}
