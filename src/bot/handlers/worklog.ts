import { Context, InlineKeyboard } from 'grammy'
import { db } from '@/lib/db'
import { tasks } from '@/lib/db/schema'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { BotContext } from '../middleware/user'
import { createWorklog, formatMinutes, todayInTz } from '@/lib/worklog/service'
import { escapeMarkdown } from '../services/markdown'

/**
 * Списание времени из переписки.
 *
 * Та же механика, что в Mini App: задача → длительность → комментарий. Шаги
 * едут в `callback_data`, где всего 64 байта, поэтому комментарий передаётся
 * индексом пресета, а не текстом: «Обсуждение задачи» кириллицей заняло бы
 * больше трети лимита.
 *
 * На каждом шаге есть «Назад» и «Отмена». Без них список задач оставался
 * висеть насовсем: выйти из него было нечем, а нажатие другой кнопки
 * оставляло оборванный диалог посреди переписки.
 */
const MINUTES = [15, 30, 60, 120, 240]
const COMMENTS = ['Разработка', 'Обсуждение задачи', 'Правки', 'Дейли', 'Новый функционал']

/** Текст и клавиатура выбора задачи — общие для команды и шага «назад». */
export async function issueListMessage(
  userId: string,
): Promise<{ text: string; keyboard: InlineKeyboard } | null> {
  const rows = await db
    .select({ externalId: tasks.externalId, title: tasks.title })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNotNull(tasks.externalId),
        inArray(tasks.status, ['TODO', 'IN_PROGRESS']),
      ),
    )
    .orderBy(tasks.status)
    .limit(8)

  if (rows.length === 0) return null

  const keyboard = new InlineKeyboard()
  for (const row of rows) {
    if (!row.externalId) continue
    const title = row.title.length > 29 ? `${row.title.slice(0, 28)}…` : row.title
    keyboard.text(`${row.externalId} — ${title}`, `wl:issue:${row.externalId}`).row()
  }
  keyboard.text('❌ Отмена', 'wl:x')

  return { text: 'В какую задачу списать время?', keyboard }
}

export async function handleWorklogCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data
  if (!data?.startsWith('wl:')) return false

  const [, step, issueKey, minutesRaw, commentIdxRaw] = data.split(':')

  if (step === 'x') {
    await ctx.editMessageText('❌ Списание отменено')
    await ctx.answerCallbackQuery()
    return true
  }

  if (step === 'back') {
    const { dbUser } = ctx as BotContext
    const list = await issueListMessage(dbUser.id)
    if (list) {
      await ctx.editMessageText(list.text, { reply_markup: list.keyboard })
    } else {
      await ctx.editMessageText('Активных задач Трекера нет — списывать не во что.')
    }
    await ctx.answerCallbackQuery()
    return true
  }

  if (step === 'issue') {
    const keyboard = new InlineKeyboard()
    for (const minutes of MINUTES) {
      keyboard.text(formatMinutes(minutes), `wl:m:${issueKey}:${minutes}`)
    }
    keyboard.row().text('⬅️ Назад', 'wl:back').text('❌ Отмена', 'wl:x')
    await ctx.editMessageText(`\`${issueKey}\` — сколько списать?`, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    })
    await ctx.answerCallbackQuery()
    return true
  }

  if (step === 'm') {
    const keyboard = new InlineKeyboard()
    COMMENTS.forEach((comment, index) => {
      keyboard.text(comment, `wl:c:${issueKey}:${minutesRaw}:${index}`).row()
    })
    keyboard.text('⬅️ Назад', `wl:issue:${issueKey}`).text('❌ Отмена', 'wl:x')
    await ctx.editMessageText(
      `\`${issueKey}\` · ${formatMinutes(Number(minutesRaw))}\nЗа что списываем?`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    )
    await ctx.answerCallbackQuery()
    return true
  }

  if (step === 'c') {
    const { dbUser } = ctx as BotContext
    const timezone = dbUser.timezone || 'Europe/Moscow'
    const minutes = Number(minutesRaw)
    const comment = COMMENTS[Number(commentIdxRaw)] ?? COMMENTS[0]

    const [task] = await db
      .select({ title: tasks.title })
      .from(tasks)
      .where(and(eq(tasks.userId, dbUser.id), eq(tasks.externalId, issueKey)))
      .limit(1)

    const result = await createWorklog({
      userId: dbUser.id,
      timezone,
      day: todayInTz(timezone),
      issueKey,
      issueTitle: task?.title ?? null,
      minutes,
      comment,
    })

    if (result.ok) {
      await ctx.editMessageText(
        `✅ \`${issueKey}\` — ${formatMinutes(minutes)}\n${escapeMarkdown(comment)}`,
        { parse_mode: 'Markdown' },
      )
    } else {
      await ctx.editMessageText(`⚠️ Трекер не принял: ${escapeMarkdown(result.error.slice(0, 200))}`, {
        parse_mode: 'Markdown',
      })
    }
    await ctx.answerCallbackQuery()
    return true
  }

  return false
}
