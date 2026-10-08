import { InlineKeyboard } from 'grammy'
import { bot } from '@/bot'
import { formatSlot, partstatLabel } from '@/lib/calendar/format'
import type { MeetingNotice } from '@/lib/calendar/sync'

/**
 * Сообщения о встречах из Яндекс.Календаря.
 *
 * Текст плоский, без Markdown: тема встречи приходит от кого угодно и
 * спокойно содержит `*`, `_` и скобки, на которых разметка ломается, а
 * сообщение уходит целиком нечитаемым.
 */

/** Ответ на приглашение. Короткие коды — в callback_data всего 64 байта. */
export const PARTSTAT_BY_CODE: Record<string, string> = {
  y: 'ACCEPTED',
  n: 'DECLINED',
  m: 'TENTATIVE',
}

function responseKeyboard(meeting: MeetingNotice): InlineKeyboard | undefined {
  if (!meeting.canRespond) return undefined
  return new InlineKeyboard()
    .text('✅ Буду', `cal:y:${meeting.id}`)
    .text('❌ Не буду', `cal:n:${meeting.id}`)
    .text('🤔 Может быть', `cal:m:${meeting.id}`)
}

/** Карточка встречи: тема, время, место, организатор. */
function meetingLines(meeting: MeetingNotice, timezone: string): string[] {
  const lines = [
    meeting.summary,
    formatSlot(meeting.startsAt, meeting.endsAt, meeting.allDay, timezone),
  ]
  if (meeting.location) lines.push(`📍 ${meeting.location}`)
  if (meeting.organizer) lines.push(`Организатор: ${meeting.organizer}`)
  return lines
}

/**
 * Новые приглашения — по сообщению на встречу.
 *
 * Сводкой их не слепить: у каждой встречи свои кнопки ответа, а одно
 * сообщение несёт одну клавиатуру.
 */
export async function notifyInvitations(
  telegramId: bigint | number,
  timezone: string,
  meetings: MeetingNotice[],
): Promise<void> {
  const chatId = telegramId.toString()
  for (const meeting of meetings) {
    try {
      await bot.api.sendMessage(chatId, ['📅 Новая встреча', '', ...meetingLines(meeting, timezone)].join('\n'), {
        reply_markup: responseKeyboard(meeting),
      })
    } catch (error) {
      console.error('Ошибка отправки приглашения на встречу:', error)
    }
  }
}

/** Перенос: показываем, что было, и предлагаем ответить заново. */
export async function notifyMoved(
  telegramId: bigint | number,
  timezone: string,
  items: Array<{ meeting: MeetingNotice; previousStart: Date }>,
): Promise<void> {
  const chatId = telegramId.toString()
  for (const { meeting, previousStart } of items) {
    try {
      const was = formatSlot(previousStart, previousStart, meeting.allDay, timezone)
      await bot.api.sendMessage(
        chatId,
        ['🔀 Встречу перенесли', '', ...meetingLines(meeting, timezone), '', `Было: ${was}`].join('\n'),
        { reply_markup: responseKeyboard(meeting) },
      )
    } catch (error) {
      console.error('Ошибка отправки переноса встречи:', error)
    }
  }
}

/** Отмена: кнопок нет, отвечать уже не на что. */
export async function notifyCancelled(
  telegramId: bigint | number,
  timezone: string,
  meetings: MeetingNotice[],
): Promise<void> {
  if (meetings.length === 0) return
  const chatId = telegramId.toString()
  try {
    if (meetings.length === 1) {
      await bot.api.sendMessage(
        chatId,
        ['🚫 Встречу отменили', '', ...meetingLines(meetings[0], timezone)].join('\n'),
      )
      return
    }
    const body = meetings
      .map(
        (m) =>
          `• ${m.summary} — ${formatSlot(m.startsAt, m.endsAt, m.allDay, timezone)}`,
      )
      .join('\n')
    await bot.api.sendMessage(chatId, `🚫 Отменены встречи (${meetings.length}):\n\n${body}`)
  } catch (error) {
    console.error('Ошибка отправки отмены встречи:', error)
  }
}

/** Строка встречи для утреннего дайджеста. */
export function digestLine(meeting: {
  summary: string
  startsAt: Date
  endsAt: Date
  allDay: boolean
  partstat: string
}, timezone: string): string {
  const time = meeting.allDay
    ? 'весь день'
    : formatSlot(meeting.startsAt, meeting.endsAt, false, timezone).split(', ').slice(-1)[0]
  const answer = meeting.partstat === 'NEEDS-ACTION' ? ' · без ответа' : ''
  return `• ${time} — ${meeting.summary}${answer}`
}

/** Подпись ответа под сообщением после нажатия кнопки. */
export function answerLine(partstat: string): string {
  return `Ответ отправлен: ${partstatLabel(partstat)}`
}
