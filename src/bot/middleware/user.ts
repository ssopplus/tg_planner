import { Context, NextFunction } from 'grammy'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export interface BotContext extends Context {
  dbUser: typeof users.$inferSelect
}

/**
 * Middleware: извлекает пользователя из БД по telegram_id.
 * Если пользователя нет — создаёт нового.
 */
export async function userMiddleware(ctx: Context, next: NextFunction) {
  const telegramUser = ctx.from
  if (!telegramUser) {
    return next()
  }

  const telegramId = BigInt(telegramUser.id)

  let [dbUser] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1)

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
