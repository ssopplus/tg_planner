import { Context, InlineKeyboard } from 'grammy'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { boards } from '@/lib/db/schema'
import { BotContext } from '../middleware/user'
import { escapeMarkdown } from '../services/markdown'
import {
  findAwaitingTitle,
  getPendingTask,
  updatePendingTask,
  type PendingTask,
} from '../services/pending-store'
import { confirmKeyboard } from '../keyboards/task'
import { todayInTz } from '@/lib/worklog/service'
import { addDays, dueForColumn, formatDue } from '@/lib/boards/due-dates'
import { ensureInboxBoard } from '@/lib/boards/inbox'

/**
 * Правка разобранного дела до его создания.
 *
 * Парсер ошибается в предсказуемых местах — не та доска, не тот срок, лишние
 * слова в названии, — и раньше единственным выходом было отменить и
 * переписать фразу целиком. Здесь те же четыре поля правятся кнопками, а
 * черновик остаётся тем же: подтверждение создаёт задачу из него.
 *
 * Все callback_data укладываются в 64 байта: идентификатор черновика — восемь
 * символов, самый длинный вариант `ed:bd:<8>:<uuid доски>` даёт 51.
 */

const PRIORITY_LABEL: Record<string, string> = {
  LOW: 'низкая',
  MEDIUM: 'обычная',
  HIGH: 'высокая',
}

/** Карточка черновика — то же, что видно до правок, плюс доска и важность. */
async function renderCard(
  userId: string,
  timezone: string,
  pending: PendingTask,
): Promise<string> {
  const today = todayInTz(timezone)
  const lines = [`📝 *${escapeMarkdown(pending.title)}*`]

  const due = pending.dueDate ?? pending.deadlineAt?.toLocaleDateString('en-CA') ?? null
  lines.push(`📅 Срок: ${due ? escapeMarkdown(formatDue(due, today) ?? due) : 'не задан'}`)

  let boardName = 'Входящие'
  if (pending.boardId) {
    const [board] = await db
      .select({ name: boards.name, emoji: boards.emoji })
      .from(boards)
      .where(and(eq(boards.id, pending.boardId), eq(boards.userId, userId)))
      .limit(1)
    if (board) boardName = `${board.emoji ? `${board.emoji} ` : ''}${board.name}`
  }
  lines.push(`🗂 Доска: ${escapeMarkdown(boardName)}`)
  lines.push(`❗️ Важность: ${PRIORITY_LABEL[pending.priority ?? 'MEDIUM']}`)

  return lines.join('\n')
}

/** Меню правки: одно поле — одна кнопка. */
function editMenuKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('📝 Название', `ed:title:${id}`)
    .text('📅 Срок', `ed:due:${id}`)
    .row()
    .text('🗂 Доска', `ed:board:${id}`)
    .text('❗️ Важность', `ed:prio:${id}`)
    .row()
    .text('✅ Создать', `confirm:${id}`)
    .text('❌ Отмена', `cancel:${id}`)
}

function dueKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Сегодня', `ed:dd:${id}:today`)
    .text('Завтра', `ed:dd:${id}:tomorrow`)
    .row()
    .text('На неделе', `ed:dd:${id}:week`)
    .text('Потом', `ed:dd:${id}:later`)
    .row()
    .text('Без срока', `ed:dd:${id}:none`)
    .text('⬅️ Назад', `ed:menu:${id}`)
}

function priorityKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Низкая', `ed:pr:${id}:LOW`)
    .text('Обычная', `ed:pr:${id}:MEDIUM`)
    .text('Высокая', `ed:pr:${id}:HIGH`)
    .row()
    .text('⬅️ Назад', `ed:menu:${id}`)
}

async function boardKeyboard(userId: string, id: string): Promise<InlineKeyboard> {
  const rows = await db
    .select({ id: boards.id, name: boards.name, emoji: boards.emoji })
    .from(boards)
    .where(eq(boards.userId, userId))
    .orderBy(asc(boards.sortOrder))
    .limit(12)

  const keyboard = new InlineKeyboard()
  rows.forEach((board, index) => {
    keyboard.text(`${board.emoji ? `${board.emoji} ` : ''}${board.name}`, `ed:bd:${id}:${board.id}`)
    // По две доски в ряд: названия короткие, в одну колонку список тянется.
    if (index % 2 === 1) keyboard.row()
  })
  keyboard.row().text('⬅️ Назад', `ed:menu:${id}`)
  return keyboard
}

/** Показать карточку с нужной клавиатурой, заменив текущее сообщение. */
async function showMenu(ctx: Context, id: string, keyboard: InlineKeyboard) {
  const { dbUser } = ctx as BotContext
  const pending = await getPendingTask(id)
  if (!pending) {
    await ctx.editMessageText('Черновик устарел — заведите дело заново.')
    return
  }
  const text = await renderCard(dbUser.id, dbUser.timezone || 'Europe/Moscow', pending)
  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard })
}

/**
 * Разбирает callback'и правки. Возвращает false, если префикс не наш.
 */
export async function handleTaskEditCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data
  if (!data?.startsWith('ed:') && !data?.startsWith('edit:')) return false

  const { dbUser } = ctx as BotContext
  const timezone = dbUser.timezone || 'Europe/Moscow'

  // Кнопка «✏️ Изменить» на карточке подтверждения.
  if (data.startsWith('edit:')) {
    const id = data.slice('edit:'.length)
    await showMenu(ctx, id, editMenuKeyboard(id))
    await ctx.answerCallbackQuery()
    return true
  }

  const [, action, id, param] = data.split(':')

  switch (action) {
    case 'menu':
      await showMenu(ctx, id, editMenuKeyboard(id))
      break

    case 'due':
      await showMenu(ctx, id, dueKeyboard(id))
      break

    case 'prio':
      await showMenu(ctx, id, priorityKeyboard(id))
      break

    case 'board':
      await showMenu(ctx, id, await boardKeyboard(dbUser.id, id))
      break

    case 'dd': {
      const today = todayInTz(timezone)
      const dueDate =
        param === 'tomorrow'
          ? addDays(today, 1)
          : param === 'none'
            ? null
            : dueForColumn(param as 'today' | 'week' | 'later', today)
      await updatePendingTask(id, { dueDate })
      await showMenu(ctx, id, editMenuKeyboard(id))
      break
    }

    case 'pr':
      await updatePendingTask(id, { priority: param as 'LOW' | 'MEDIUM' | 'HIGH' })
      await showMenu(ctx, id, editMenuKeyboard(id))
      break

    case 'bd':
      await updatePendingTask(id, { boardId: param })
      await showMenu(ctx, id, editMenuKeyboard(id))
      break

    case 'title': {
      await updatePendingTask(id, { awaitingTitle: true })
      await ctx.reply('Пришлите новое название одним сообщением.')
      break
    }
  }

  await ctx.answerCallbackQuery()
  return true
}

/**
 * Перехватывает сообщение, которым пользователь прислал новое название.
 *
 * Стоит до AI-парсера: иначе «Поменять резину» ушло бы в разбор и стало
 * второй задачей вместо правки первой.
 */
export async function handleTitleReply(ctx: Context, text: string): Promise<boolean> {
  const { dbUser } = ctx as BotContext
  const awaiting = await findAwaitingTitle(dbUser.id)
  if (!awaiting) return false

  const updated = await updatePendingTask(awaiting.id, {
    title: text.trim(),
    awaitingTitle: false,
  })
  if (!updated) {
    await ctx.reply('Черновик устарел — заведите дело заново.')
    return true
  }

  const card = await renderCard(dbUser.id, dbUser.timezone || 'Europe/Moscow', updated)
  await ctx.reply(card, { parse_mode: 'Markdown', reply_markup: confirmKeyboard(awaiting.id) })
  return true
}

/** Доска черновика: выбранная руками или «Входящие». */
export async function resolveEditedBoard(userId: string, boardId?: string) {
  if (boardId) {
    const [board] = await db
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.id, boardId), eq(boards.userId, userId)))
      .limit(1)
    if (board) return board
  }
  return ensureInboxBoard(userId)
}
