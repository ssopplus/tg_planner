import { Context, NextFunction } from 'grammy'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export interface BotContext extends Context {
  dbUser: typeof users.$inferSelect
}

/**
 * Telegram id, которым бот заведёт пользователя при первом сообщении: через запятую.
 * Бот личный, а раньше заводил пользователя каждому, кто ему написал. Список пуст —
 * новых не заводим совсем, уже заведённые работают как раньше.
 */
function allowedNewUser(telegramId: number): boolean {
  return (process.env.BOT_ALLOWED_TELEGRAM_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .includes(String(telegramId))
}

/**
 * Middleware: извлекает пользователя из БД по telegram_id.
 * Если пользователя нет — заводит, только когда id есть в BOT_ALLOWED_TELEGRAM_IDS;
 * остальным отвечает «нет доступа» и дальше обновление не пропускает.
 */
export async function userMiddleware(ctx: Context, next: NextFunction) {
  const telegramUser = ctx.from
  if (!telegramUser) {
    return next()
  }

  const telegramId = BigInt(telegramUser.id)

  let [dbUser] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1)

  if (!dbUser && !allowedNewUser(telegramUser.id)) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Нет доступа' }).catch(() => {})
    else if (ctx.chat?.type === 'private' && ctx.message) await ctx.reply('Это личный бот, доступа нет.').catch(() => {})
    return
  }

  if (!dbUser) {
    ;[dbUser] = await db
      .insert(users)
      .values({
        telegramId,
        username: telegramUser.username ?? null,
        firstName: telegramUser.first_name ?? null,
      })
      .returning()
  }

  ;(ctx as BotContext).dbUser = dbUser
  return next()
}
