import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { reminders, tasks, users } from '@/lib/db/schema'
import { eq, and, lte } from 'drizzle-orm'
import { bot } from '@/bot'
import { reminderKeyboard } from '@/bot/keyboards/task'
import { getNextOccurrence } from '@/lib/reminders/rrule-parser'

/**
 * Cron endpoint для отправки напоминаний.
 * Vercel Cron: каждую минуту.
 * Поддерживает повторяющиеся напоминания (rrule).
 */
export async function GET(request: Request) {
  // Проверка Vercel Cron секрета
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  // Находим все напоминания, которые пора отправить
  const pendingReminders = await db
    .select({
      reminderId: reminders.id,
      taskTitle: tasks.title,
      taskId: tasks.id,
      telegramId: users.telegramId,
      userId: reminders.userId,
      isRecurring: reminders.isRecurring,
      rrule: reminders.rrule,
    })
    .from(reminders)
    .innerJoin(tasks, eq(reminders.taskId, tasks.id))
    .innerJoin(users, eq(reminders.userId, users.id))
    .where(and(eq(reminders.status, 'PENDING'), lte(reminders.remindAt, now)))
    .limit(50)

  let sent = 0

  for (const reminder of pendingReminders) {
    try {
      // Отправляем с inline-кнопками
      await bot.api.sendMessage(
        reminder.telegramId.toString(),
        `⏰ **Напоминание:** ${reminder.taskTitle}`,
        {
          parse_mode: 'Markdown',
          reply_markup: reminderKeyboard(reminder.taskId),
        },
      )

      // Отмечаем как отправленное
      await db
        .update(reminders)
        .set({ status: 'SENT' })
        .where(eq(reminders.id, reminder.reminderId))

      // Если повторяющееся — создаём следующее
      if (reminder.isRecurring && reminder.rrule) {
        const nextDate = getNextOccurrence(reminder.rrule, now)
        if (nextDate) {
          await db.insert(reminders).values({
            taskId: reminder.taskId,
            userId: reminder.userId,
            remindAt: nextDate,
            type: 'TIME',
            rrule: reminder.rrule,
            isRecurring: true,
          })
        }
      }

      sent++
    } catch (error) {
      console.error(`Ошибка отправки напоминания ${reminder.reminderId}:`, error)
    }
  }

  return NextResponse.json({ ok: true, sent, total: pendingReminders.length })
}
