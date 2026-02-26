import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { reminders, tasks, users } from '@/lib/db/schema'
import { eq, and, lte } from 'drizzle-orm'
import { bot } from '@/bot'

/**
 * Cron endpoint для отправки напоминаний.
 * Vercel Cron: каждую минуту.
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
    })
    .from(reminders)
    .innerJoin(tasks, eq(reminders.taskId, tasks.id))
    .innerJoin(users, eq(reminders.userId, users.id))
    .where(and(eq(reminders.status, 'PENDING'), lte(reminders.remindAt, now)))
    .limit(50)

  let sent = 0

  for (const reminder of pendingReminders) {
    try {
      await bot.api.sendMessage(
        reminder.telegramId.toString(),
        `⏰ **Напоминание:** ${reminder.taskTitle}`,
        { parse_mode: 'Markdown' },
      )

      // Отмечаем как отправленное
      await db
        .update(reminders)
        .set({ status: 'SENT' })
        .where(eq(reminders.id, reminder.reminderId))

      sent++
    } catch (error) {
      console.error(`Ошибка отправки напоминания ${reminder.reminderId}:`, error)
    }
  }

  return NextResponse.json({ ok: true, sent, total: pendingReminders.length })
}
