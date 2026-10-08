import { Context, InlineKeyboard } from 'grammy'
import { and, asc, eq, gte, lt, ne } from 'drizzle-orm'
import { db } from '@/lib/db'
import { calendarEvents } from '@/lib/db/schema'
import { BotContext } from '../middleware/user'
import { escapeMarkdown } from '../services/markdown'
import { caldavConfig } from '@/lib/calendar/caldav'
import { formatStartTime, partstatLabel, startOfToday } from '@/lib/calendar/format'

/**
 * Встречи из Яндекс.Календаря списком в боте.
 *
 * Читаем зеркало `calendar_events`, а не CalDAV: список спрашивают часто, а
 * обновляет зеркало cron каждые 15 минут — ходить в календарь на каждое
 * нажатие незачем.
 */

type MeetingRange = 'today' | 'tomorrow' | 'week'

const RANGE_TITLE: Record<MeetingRange, string> = {
  today: '📆 *Встречи сегодня*',
  tomorrow: '📆 *Встречи завтра*',
  week: '📆 *Встречи на неделю*',
}

/** Границы окна в миллисекундах от начала текущих суток пользователя. */
const RANGE_WINDOW: Record<MeetingRange, [number, number]> = {
  today: [0, 86_400_000],
  tomorrow: [86_400_000, 2 * 86_400_000],
  week: [0, 7 * 86_400_000],
}

function rangeKeyboard(active: MeetingRange): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  const options: Array<[MeetingRange, string]> = [
    ['today', 'Сегодня'],
    ['tomorrow', 'Завтра'],
    ['week', 'Неделя'],
  ]
  for (const [range, label] of options) {
    if (range !== active) keyboard.text(label, `meet:${range}`)
  }
  return keyboard
}

async function buildList(userId: string, timezone: string, range: MeetingRange): Promise<string> {
  if (!caldavConfig()) {
    return '📆 Календарь не подключён.\n\nНужен пароль приложения Яндекса — см. docs/yandex-calendar.md.'
  }

  const dayStart = startOfToday(timezone)
  const [fromOffset, toOffset] = RANGE_WINDOW[range]
  const from = new Date(dayStart.getTime() + fromOffset)
  const to = new Date(dayStart.getTime() + toOffset)

  const rows = await db
    .select({
      summary: calendarEvents.summary,
      startsAt: calendarEvents.startsAt,
      allDay: calendarEvents.allDay,
      location: calendarEvents.location,
      partstat: calendarEvents.partstat,
    })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.userId, userId),
        gte(calendarEvents.startsAt, from),
        lt(calendarEvents.startsAt, to),
        ne(calendarEvents.status, 'CANCELLED'),
      ),
    )
    .orderBy(asc(calendarEvents.startsAt))
    .limit(40)

  const lines = [RANGE_TITLE[range]]
  if (rows.length === 0) {
    lines.push('', range === 'week' ? 'На неделе встреч нет.' : 'Встреч нет — день свободен.')
    return lines.join('\n')
  }

  // На неделе группируем по дням: сплошной список без дат нечитаем.
  let lastDay = ''
  for (const row of rows) {
    if (range === 'week') {
      const day = row.startsAt.toLocaleDateString('ru-RU', {
        timeZone: timezone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
      if (day !== lastDay) {
        lines.push('', `*${escapeMarkdown(day)}*`)
        lastDay = day
      }
    }
    const time = formatStartTime(row.startsAt, row.allDay, timezone)
    const answer = row.partstat === 'NEEDS-ACTION' ? ' · без ответа' : ''
    const where = row.location ? ` · ${row.location}` : ''
    lines.push(`• ${time} — ${escapeMarkdown(row.summary)}${escapeMarkdown(answer + where)}`)
  }

  const unanswered = rows.filter((r) => r.partstat === 'NEEDS-ACTION').length
  if (unanswered > 0) {
    lines.push('', `_Без ответа: ${unanswered}. Ответить можно в уведомлении о встрече._`)
  } else {
    lines.push('', `_Мой ответ на все: ${partstatLabel(rows[0].partstat)}._`)
  }

  return lines.join('\n')
}

/** /meet — встречи на сегодня. */
export async function handleMeetingsCommand(ctx: Context) {
  const { dbUser } = ctx as BotContext
  const text = await buildList(dbUser.id, dbUser.timezone || 'Europe/Moscow', 'today')
  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: rangeKeyboard('today') })
}

/** Переключение дня кнопкой под тем же сообщением. */
export async function handleMeetingsCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data
  if (!data?.startsWith('meet:')) return false

  const range = data.slice('meet:'.length) as MeetingRange
  if (!['today', 'tomorrow', 'week'].includes(range)) {
    await ctx.answerCallbackQuery()
    return true
  }

  const { dbUser } = ctx as BotContext
  const text = await buildList(dbUser.id, dbUser.timezone || 'Europe/Moscow', range)
  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: rangeKeyboard(range) })
  await ctx.answerCallbackQuery()
  return true
}
