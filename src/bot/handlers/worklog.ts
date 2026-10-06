import { Context, InlineKeyboard } from 'grammy'
import { db } from '@/lib/db'
import { tasks } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
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
 */
const MINUTES = [15, 30, 60, 120, 240]
const COMMENTS = ['Разработка', 'Обсуждение задачи', 'Правки', 'Дейли', 'Новый функционал']

export async function handleWorklogCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data
  if (!data?.startsWith('wl:')) return false

  const [, step, issueKey, minutesRaw, commentIdxRaw] = data.split(':')

  if (step === 'issue') {
    const keyboard = new InlineKeyboard()
    for (const minutes of MINUTES) {
      keyboard.text(formatMinutes(minutes), `wl:m:${issueKey}:${minutes}`)
    }
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
