import { Context } from 'grammy'
import { db } from '@/lib/db'
import { tasks, projects } from '@/lib/db/schema'
import { eq, and, lte } from 'drizzle-orm'
import { BotContext } from '../middleware/user'
import { taskActionsKeyboard } from '../keyboards/task'

/**
 * /tasks — список активных задач
 * /today — задачи на сегодня (с дедлайном до конца дня)
 */
export async function handleTasks(ctx: Context) {
  const { dbUser } = ctx as BotContext
  const isToday = ctx.message?.text?.startsWith('/today')

  let userTasks

  if (isToday) {
    const endOfDay = new Date()
    endOfDay.setHours(23, 59, 59, 999)

    userTasks = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        priority: tasks.priority,
        deadlineAt: tasks.deadlineAt,
        projectName: projects.name,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(tasks.userId, dbUser.id),
          eq(tasks.status, 'TODO'),
          lte(tasks.deadlineAt, endOfDay),
        ),
      )
      .orderBy(tasks.deadlineAt)
  } else {
    userTasks = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        priority: tasks.priority,
        deadlineAt: tasks.deadlineAt,
        projectName: projects.name,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(eq(tasks.userId, dbUser.id), eq(tasks.status, 'TODO')))
      .orderBy(tasks.deadlineAt)
      .limit(20)
  }

  if (userTasks.length === 0) {
    const msg = isToday ? 'На сегодня задач нет! 🎉' : 'У тебя нет активных задач. Напиши текст, чтобы создать.'
    await ctx.reply(msg)
    return
  }

  const title = isToday ? '📅 **Задачи на сегодня:**' : '📋 **Активные задачи:**'

  // Отправляем каждую задачу отдельным сообщением с кнопками
  await ctx.reply(title + `\n\nВсего: ${userTasks.length}`, { parse_mode: 'Markdown' })

  for (const task of userTasks.slice(0, 10)) {
    const priorityIcon = task.priority === 'HIGH' ? '🔴' : task.priority === 'MEDIUM' ? '🟡' : '🟢'
    const deadline = task.deadlineAt
      ? ` | 📅 ${task.deadlineAt.toLocaleDateString('ru-RU')}`
      : ''
    const project = task.projectName ? ` | 📁 ${task.projectName}` : ''

    await ctx.reply(`${priorityIcon} **${task.title}**${deadline}${project}`, {
      parse_mode: 'Markdown',
      reply_markup: taskActionsKeyboard(task.id),
    })
  }

  if (userTasks.length > 10) {
    await ctx.reply(`...и ещё ${userTasks.length - 10} задач`)
  }
}
