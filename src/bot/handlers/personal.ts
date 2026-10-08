import { Context, InlineKeyboard } from 'grammy'
import { and, asc, eq, isNotNull, isNull, lte, notInArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { boards, tasks } from '@/lib/db/schema'
import { BotContext } from '../middleware/user'
import { escapeMarkdown } from '../services/markdown'
import { todayInTz } from '@/lib/worklog/service'
import { addDays, formatDue } from '@/lib/boards/due-dates'
import { miniAppUrl } from '@/lib/telegram/mini-app-url'

/**
 * Личные дела в боте: тот же срез, что и колонки доски, но текстом.
 *
 * Горизонт переключается кнопками под сообщением, а не отдельными командами:
 * «сегодня» и «на неделе» — один и тот же список с разной границей, и помнить
 * две команды ради этого незачем.
 */

export type PersonalRange = 'today' | 'week' | 'none'

const RANGE_TITLE: Record<PersonalRange, string> = {
  today: '🏠 *Дела на сегодня*',
  week: '🏠 *Дела на неделю*',
  none: '🏠 *Дела без срока*',
}

/** Кнопки переключения горизонта; текущий режим не дублируем. */
function rangeKeyboard(active: PersonalRange): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  const options: Array<[PersonalRange, string]> = [
    ['today', 'Сегодня'],
    ['week', 'На неделе'],
    ['none', 'Без срока'],
  ]
  for (const [range, label] of options) {
    if (range !== active) keyboard.text(label, `pers:${range}`)
  }
  const url = miniAppUrl('/boards')
  if (url) keyboard.row().webApp('📱 Открыть доски', url)
  return keyboard
}

/**
 * Собирает текст списка.
 *
 * «Сегодня» намеренно включает просроченное: вчерашнее дело сегодня нужно
 * сделать сегодня, и отдельная строка для него — способ его не заметить.
 */
async function buildList(userId: string, timezone: string, range: PersonalRange) {
  const today = todayInTz(timezone)

  const horizon =
    range === 'today'
      ? lte(tasks.dueDate, today)
      : range === 'week'
        ? and(isNotNull(tasks.dueDate), lte(tasks.dueDate, addDays(today, 7)))
        : isNull(tasks.dueDate)

  const rows = await db
    .select({
      title: tasks.title,
      dueDate: tasks.dueDate,
      priority: tasks.priority,
      boardName: boards.name,
      boardEmoji: boards.emoji,
    })
    .from(tasks)
    .leftJoin(boards, eq(tasks.boardId, boards.id))
    .where(
      and(
        eq(tasks.userId, userId),
        isNotNull(tasks.boardId),
        notInArray(tasks.status, ['DONE', 'ARCHIVED']),
        horizon,
      ),
    )
    .orderBy(asc(tasks.dueDate), asc(tasks.sortOrder))
    .limit(30)

  const lines = [RANGE_TITLE[range]]
  if (rows.length === 0) {
    lines.push('', range === 'none' ? 'Дел без срока нет.' : 'Таких дел нет — пусто.')
    return lines.join('\n')
  }

  // Группируем по доске: «Дом» и «Машина» в одном списке вперемешку читаются
  // хуже, чем двумя блоками.
  const byBoard = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = `${row.boardEmoji ? `${row.boardEmoji} ` : ''}${row.boardName ?? 'Входящие'}`
    const list = byBoard.get(key) ?? []
    list.push(row)
    byBoard.set(key, list)
  }

  for (const [board, items] of byBoard) {
    lines.push('', `*${escapeMarkdown(board)}*`)
    for (const item of items) {
      const due = formatDue(item.dueDate, today)
      const when = due && range !== 'today' ? ` · ${due}` : due?.startsWith('просрочено') ? ` · ${due}` : ''
      const important = item.priority === 'HIGH' ? '❗️ ' : ''
      lines.push(`• ${important}${escapeMarkdown(item.title)}${escapeMarkdown(when)}`)
    }
  }

  return lines.join('\n')
}

/** /dela — список личных дел, по умолчанию на сегодня. */
export async function handlePersonalCommand(ctx: Context) {
  const { dbUser } = ctx as BotContext
  const text = await buildList(dbUser.id, dbUser.timezone || 'Europe/Moscow', 'today')
  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: rangeKeyboard('today') })
}

/** Переключение горизонта кнопкой под тем же сообщением. */
export async function handlePersonalCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data
  if (!data?.startsWith('pers:')) return false

  const range = data.slice('pers:'.length) as PersonalRange
  if (!['today', 'week', 'none'].includes(range)) {
    await ctx.answerCallbackQuery()
    return true
  }

  const { dbUser } = ctx as BotContext
  const text = await buildList(dbUser.id, dbUser.timezone || 'Europe/Moscow', range)
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: rangeKeyboard(range),
  })
  await ctx.answerCallbackQuery()
  return true
}
