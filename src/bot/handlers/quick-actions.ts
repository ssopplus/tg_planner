import { Context, InlineKeyboard } from 'grammy'
import { db } from '@/lib/db'
import { boards, tasks } from '@/lib/db/schema'
import { and, eq, inArray, isNotNull, lte, notInArray, or, isNull } from 'drizzle-orm'
import { BotContext } from '../middleware/user'
import { handlePersonalCommand } from './personal'
import { handleMeetingsCommand } from './meetings'
import { escapeMarkdown } from '../services/markdown'
import { ensureInboxBoard } from '@/lib/boards/inbox'
import { toDayString } from '@/lib/boards/due-dates'
import { formatMinutes, readWorklogDay, todayInTz } from '@/lib/worklog/service'
import {
  BUTTON_LOG_TIME,
  BUTTON_MEETINGS,
  BUTTON_NEW_TASK,
  BUTTON_PERSONAL,
  BUTTON_TODAY,
} from '../keyboards/main'

/**
 * Быстрые действия с постоянной клавиатуры.
 *
 * Кнопки — не команды со слэшем: Telegram шлёт их как обычный текст, поэтому
 * обработчик стоит раньше AI-парсера сообщений и перехватывает ровно эти
 * строки.
 */
export async function handleQuickAction(ctx: Context, text: string): Promise<boolean> {
  switch (text) {
    case BUTTON_NEW_TASK:
      await ctx.reply(
        'Напишите дело одним сообщением — разберу срок и доску.\n' +
          'Например: «поменять резину на машине на следующей неделе».',
      )
      return true

    case BUTTON_LOG_TIME:
      await askWhichIssue(ctx)
      return true

    case BUTTON_TODAY:
      await sendToday(ctx)
      return true

    case BUTTON_PERSONAL:
      await handlePersonalCommand(ctx)
      return true

    case BUTTON_MEETINGS:
      await handleMeetingsCommand(ctx)
      return true

    default:
      return false
  }
}

/**
 * Список задач для списания: только те, что в работе.
 *
 * Закрытые и неначатые сюда не попадают — списывают почти всегда в то, чем
 * занимались сегодня, а длинный список кнопок на телефоне бесполезен.
 */
export async function askWhichIssue(ctx: Context) {
  const { dbUser } = ctx as BotContext

  const rows = await db
    .select({ externalId: tasks.externalId, title: tasks.title })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, dbUser.id),
        isNotNull(tasks.externalId),
        inArray(tasks.status, ['TODO', 'IN_PROGRESS']),
      ),
    )
    .orderBy(tasks.status)
    .limit(8)

  if (rows.length === 0) {
    await ctx.reply('Активных задач Трекера нет — списывать не во что.')
    return
  }

  const keyboard = new InlineKeyboard()
  for (const row of rows) {
    if (!row.externalId) continue
    keyboard.text(`${row.externalId} — ${trim(row.title, 28)}`, `wl:issue:${row.externalId}`).row()
  }

  await ctx.reply('В какую задачу списать время?', { reply_markup: keyboard })
}

/** Сводка дня: рабочее сверху, личные дела снизу. */
export async function sendToday(ctx: Context) {
  const { dbUser } = ctx as BotContext
  const timezone = dbUser.timezone || 'Europe/Moscow'
  const today = todayInTz(timezone)

  const inWork = await db
    .select({ externalId: tasks.externalId, title: tasks.title })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, dbUser.id),
        isNotNull(tasks.externalId),
        eq(tasks.status, 'IN_PROGRESS'),
      ),
    )
    .limit(10)

  const personal = await db
    .select({ title: tasks.title, boardName: boards.name, boardEmoji: boards.emoji })
    .from(tasks)
    .leftJoin(boards, eq(tasks.boardId, boards.id))
    .where(
      and(
        eq(tasks.userId, dbUser.id),
        isNotNull(tasks.boardId),
        notInArray(tasks.status, ['DONE', 'ARCHIVED']),
        or(lte(tasks.dueDate, today), isNull(tasks.dueDate)),
      ),
    )
    .limit(15)

  // Дела без срока показываем отдельной строкой: они не «на сегодня», но
  // держать их совсем вне сводки — значит никогда о них не вспомнить.
  const due = personal.filter((t) => t.boardName !== null)
  const spent = await readWorklogDay(dbUser.id, today)
  const total = spent.reduce((sum, row) => sum + row.minutes, 0)

  const lines: string[] = [`📅 *Сегодня*, ${escapeMarkdown(formatToday(today))}`]

  if (inWork.length > 0) {
    lines.push('', '*В работе*')
    for (const task of inWork) {
      lines.push(`• \`${task.externalId}\` ${escapeMarkdown(trim(task.title, 42))}`)
    }
  }

  if (due.length > 0) {
    lines.push('', '*Личные дела*')
    for (const task of due.slice(0, 10)) {
      const mark = task.boardEmoji ? `${task.boardEmoji} ` : ''
      lines.push(`• ${mark}${escapeMarkdown(trim(task.title, 42))}`)
    }
  }

  if (inWork.length === 0 && due.length === 0) {
    lines.push('', 'Ни рабочих задач в работе, ни личных дел на сегодня.')
  }

  lines.push('', `⏱ Списано за день: ${total > 0 ? formatMinutes(total) : 'ничего'}`)

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' })
}

/**
 * Куда положить дело, заведённое из бота.
 *
 * Доска угадывается по названию прямо в тексте: «машина», «дом», «финансы».
 * Не нашли — «Входящие», разложить можно потом перетаскиванием на доске.
 */
export async function resolveBoardForText(
  userId: string,
  text: string,
): Promise<{ id: string; name: string; emoji: string | null }> {
  const rows = await db.select().from(boards).where(eq(boards.userId, userId))
  const haystack = text.toLowerCase()

  // Длинные названия проверяем первыми: «финансы дома» не должны отдать доску
  // «Дом», если есть более точное совпадение.
  const sorted = [...rows].sort((a, b) => b.name.length - a.name.length)
  const matched = sorted.find((board) => !board.isInbox && haystack.includes(board.name.toLowerCase()))
  if (matched) return { id: matched.id, name: matched.name, emoji: matched.emoji }

  const inbox = await ensureInboxBoard(userId)
  return { id: inbox.id, name: inbox.name, emoji: inbox.emoji }
}

/** Срок из фразы: «сегодня», «завтра», «на неделе». */
export function resolveDueFromText(text: string, today: string): string | null {
  const haystack = text.toLowerCase()
  if (haystack.includes('сегодня')) return today
  if (haystack.includes('завтра')) return shiftDay(today, 1)
  if (haystack.includes('на следующей неделе') || haystack.includes('через неделю')) {
    return shiftDay(today, 7)
  }
  if (haystack.includes('на неделе') || haystack.includes('на этой неделе')) {
    return shiftDay(today, 3)
  }
  return null
}

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() + delta)
  return toDayString(date)
}

function formatToday(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  })
}

function trim(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
