import { eq, sql } from 'drizzle-orm'
import { bot } from '@/bot'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { localTime, nextReminderState, parseReminderState, reminderDue } from '@/lib/reading/remind'
import { readingSummary, reminderMessage } from './reading'

/**
 * Напоминание о тренировке чтения. Вызывается из крона дайджестов (раз в
 * 15 минут) для каждого пользователя; само решает, пора ли писать.
 * Возвращает, что отправило, — для ответа крона.
 */
export async function sendReadingReminder(
  user: typeof users.$inferSelect,
  now = new Date(),
): Promise<'daily' | 'streak' | null> {
  const timezone = user.timezone || 'Europe/Moscow'
  const settings = (user.settings ?? {}) as Record<string, unknown>
  const summary = await readingSummary(user.id, timezone, settings.reading, now)
  const state = parseReminderState(settings.readingReminder)

  const kind = reminderDue({
    settings: summary.settings,
    state,
    today: summary.today,
    time: localTime(now, timezone),
    started: summary.started,
    trainedToday: summary.trainedToday,
    streak: summary.streak,
  })
  if (!kind) return null

  // Сначала отметка, потом отправка: при сбое лучше пропустить напоминание,
  // чем слать его каждые 15 минут до вечера.
  const next = nextReminderState(state, summary.today, kind)
  await db
    .update(users)
    .set({
      // Точечно, а не всем объектом: Mini App в это время может сохранять `reading`.
      settings: sql`(coalesce(${users.settings}::jsonb, '{}'::jsonb) || jsonb_build_object('readingReminder', ${JSON.stringify(next)}::jsonb))::json`,
    })
    .where(eq(users.id, user.id))

  const { text, keyboard } = reminderMessage(kind, summary)
  await bot.api.sendMessage(Number(user.telegramId), text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })
  return kind
}
