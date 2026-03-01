import { db } from '@/lib/db'
import { tasks, projects, users } from '@/lib/db/schema'
import { eq, and, lte, lt, gte, sql } from 'drizzle-orm'
import { bot } from '@/bot'
import { sortByScore } from './scoring'
import { overdueKeyboard, myDayKeyboard } from '../keyboards/task'

/**
 * Отправить утренний дайджест пользователю.
 */
export async function sendMorningDigest(user: typeof users.$inferSelect) {
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59)

  // Задачи на сегодня (с дедлайном сегодня)
  const todayTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      priority: tasks.priority,
      deadlineAt: tasks.deadlineAt,
      deadlineType: tasks.deadlineType,
      overdueCount: tasks.overdueCount,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, user.id),
        eq(tasks.status, 'TODO'),
        gte(tasks.deadlineAt, todayStart),
        lte(tasks.deadlineAt, todayEnd),
      ),
    )

  // Просроченные задачи
  const overdueTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      priority: tasks.priority,
      deadlineAt: tasks.deadlineAt,
      deadlineType: tasks.deadlineType,
      overdueCount: tasks.overdueCount,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(
      and(eq(tasks.userId, user.id), eq(tasks.status, 'TODO'), lt(tasks.deadlineAt, todayStart)),
    )

  // Задачи с высоким приоритетом без даты
  const highPrioTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      priority: tasks.priority,
      deadlineAt: tasks.deadlineAt,
      deadlineType: tasks.deadlineType,
      overdueCount: tasks.overdueCount,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, user.id),
        eq(tasks.status, 'TODO'),
        eq(tasks.priority, 'HIGH'),
        sql`${tasks.deadlineAt} IS NULL`,
      ),
    )
    .limit(3)

  // Общее количество активных задач
  const [{ count: totalCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.userId, user.id), eq(tasks.status, 'TODO')))

  // Формируем сообщение
  const lines: string[] = ['☀️ **Доброе утро! Вот план на сегодня:**\n']

  if (todayTasks.length > 0) {
    lines.push(`📅 **На сегодня (${todayTasks.length}):**`)
    for (const t of sortByScore(todayTasks)) {
      const icon = t.priority === 'HIGH' ? '🔴' : t.priority === 'MEDIUM' ? '🟡' : '🟢'
      const time = t.deadlineAt
        ? t.deadlineAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        : ''
      lines.push(`${icon} ${t.title}${time ? ` (${time})` : ''}`)
    }
    lines.push('')
  }

  if (overdueTasks.length > 0) {
    lines.push(`⚠️ **Просрочено (${overdueTasks.length}):**`)
    for (const t of overdueTasks.slice(0, 5)) {
      const daysOverdue = Math.floor(
        (todayStart.getTime() - (t.deadlineAt?.getTime() ?? 0)) / (1000 * 60 * 60 * 24),
      )
      lines.push(`🔴 ${t.title} (${daysOverdue} дн. назад)`)
    }
    lines.push('')
  }

  if (highPrioTasks.length > 0) {
    lines.push('🔥 **Важное без даты:**')
    for (const t of highPrioTasks) {
      lines.push(`🔴 ${t.title}`)
    }
    lines.push('')
  }

  if (todayTasks.length === 0 && overdueTasks.length === 0 && highPrioTasks.length === 0) {
    lines.push('На сегодня задач нет! Свободный день 🎉')
  }

  lines.push(`\n📊 Всего активных задач: ${totalCount}`)

  // Отправляем основное сообщение
  await bot.api.sendMessage(user.telegramId.toString(), lines.join('\n'), {
    parse_mode: 'Markdown',
  })

  // Отправляем просроченные с кнопками отдельными сообщениями
  for (const t of overdueTasks.slice(0, 3)) {
    await bot.api.sendMessage(
      user.telegramId.toString(),
      `⚠️ **${t.title}** — просрочена. Что делаем?`,
      {
        parse_mode: 'Markdown',
        reply_markup: overdueKeyboard(t.id),
      },
    )
  }
}

/**
 * Отправить вечерний итог пользователю.
 */
export async function sendEveningDigest(user: typeof users.$inferSelect) {
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  // Выполненные сегодня
  const [{ count: completedToday }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, user.id),
        eq(tasks.status, 'DONE'),
        gte(tasks.completedAt, todayStart),
      ),
    )

  // Осталось активных
  const [{ count: remaining }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.userId, user.id), eq(tasks.status, 'TODO')))

  // Просрочено
  const [{ count: overdue }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(eq(tasks.userId, user.id), eq(tasks.status, 'TODO'), lt(tasks.deadlineAt, todayStart)),
    )

  const lines: string[] = ['🌙 **Итоги дня:**\n']

  if (completedToday > 0) {
    lines.push(`✅ Выполнено: ${completedToday}`)
  } else {
    lines.push('Сегодня задачи не выполнялись.')
  }

  lines.push(`📋 Активных задач: ${remaining}`)

  if (overdue > 0) {
    lines.push(`⚠️ Просрочено: ${overdue}`)
  }

  if (completedToday >= 5) {
    lines.push('\n🏆 Отличная работа!')
  } else if (completedToday >= 3) {
    lines.push('\n👍 Хороший день!')
  }

  lines.push('\nХорошего вечера! 🌃')

  await bot.api.sendMessage(user.telegramId.toString(), lines.join('\n'), {
    parse_mode: 'Markdown',
  })
}
