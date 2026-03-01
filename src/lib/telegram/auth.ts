import crypto from 'crypto'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Валидация Telegram WebApp initData через HMAC.
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(initData: string, botToken: string): boolean {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return false

  params.delete('hash')
  const entries = Array.from(params.entries())
  entries.sort(([a], [b]) => a.localeCompare(b))
  const dataCheckString = entries.map(([key, value]) => `${key}=${value}`).join('\n')

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  return hmac === hash
}

/**
 * Извлекает данные пользователя из initData.
 */
export function parseInitData(initData: string) {
  const params = new URLSearchParams(initData)
  const userStr = params.get('user')
  if (!userStr) return null

  try {
    const user = JSON.parse(userStr)
    return {
      id: user.id as number,
      firstName: user.first_name as string,
      lastName: user.last_name as string | undefined,
      username: user.username as string | undefined,
      languageCode: user.language_code as string | undefined,
    }
  } catch {
    return null
  }
}

/**
 * Авторизует пользователя Mini App: валидация initData → поиск в БД.
 * Возвращает пользователя из БД или null.
 */
export async function authorizeMiniApp(initData: string) {
  const botToken = process.env.BOT_TOKEN
  if (!botToken) return null

  if (!validateInitData(initData, botToken)) return null

  const telegramUser = parseInitData(initData)
  if (!telegramUser) return null

  const [dbUser] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, BigInt(telegramUser.id)))
    .limit(1)

  return dbUser ?? null
}
