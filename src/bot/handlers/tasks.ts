import { Context } from 'grammy'
import { db } from '@/lib/db'
import { tasks, projects } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { BotContext } from '../middleware/user'
import { taskActionsKeyboard, myDayKeyboard } from '../keyboards/task'
import { getMyDayTasks } from '../services/my-day'
import { sortByScore } from '../services/scoring'

/**
 * /tasks — список активных задач (отсортированных по автоприоритету)
 * /today — «Мой день» (автоформирование)
 */
export async function handleTasks(ctx: Context) {
  const { dbUser } = ctx as BotContext
  const isToday = ctx.message?.text?.startsWith('/today')

  if (isToday) {
    // «Мой день» — автоформирование
    const myDayTasks = await getMyDayTasks(dbUser.id)

    if (myDayTasks.length === 0) {
      await ctx.reply('☀️ На сегодня задач нет! Свободный день 🎉')
      return
    }

    const todayStr = new Date().toISOString().split('T')[0]
    await ctx.reply(`☀️ **Мой день** (${myDayTasks.length})\n`, { parse_mode: 'Markdown' })

    for (const task of myDayTasks) {
      const priorityIcon =
        task.priority === 'HIGH' ? '🔴' : task.priority === 'MEDIUM' ? '🟡' : '🟢'
      const deadline = task.deadlineAt
        ? ` | 📅 ${task.deadlineAt.toLocaleDateString('ru-RU')}`
        : ''
      const project = task.projectName ? ` | 📁 ${task.projectName}` : ''
      const isOverdue = task.deadlineAt && task.deadlineAt < new Date() ? ' ⚠️' : ''
      const isInMyDay = task.myDayDate === todayStr

      await ctx.reply(
        `${priorityIcon} **${task.title}**${deadline}${project}${isOverdue}`,
        {
          parse_mode: 'Markdown',
          reply_markup: myDayKeyboard(task.id, isInMyDay),
        },
      )
    }
  } else {
    // Все задачи с автоприоритетом
    const userTasks = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        priority: tasks.priority,
        deadlineAt: tasks.deadlineAt,
        deadlineType: tasks.deadlineType,
        overdueCount: tasks.overdueCount,
        createdAt: tasks.createdAt,
        projectName: projects.name,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(eq(tasks.userId, dbUser.id), eq(tasks.status, 'TODO')))
      .limit(20)

    if (userTasks.length === 0) {
      await ctx.reply('У тебя нет активных задач. Напиши текст, чтобы создать.')
      return
    }

    // Сортировка по автоприоритету
    const sorted = sortByScore(userTasks)

    await ctx.reply(`📋 **Активные задачи** (${sorted.length})\n`, { parse_mode: 'Markdown' })

    for (const task of sorted.slice(0, 10)) {
      const priorityIcon =
        task.priority === 'HIGH' ? '🔴' : task.priority === 'MEDIUM' ? '🟡' : '🟢'
      const deadline = task.deadlineAt
        ? ` | 📅 ${task.deadlineAt.toLocaleDateString('ru-RU')}`
        : ''
      const project = task.projectName ? ` | 📁 ${task.projectName}` : ''
      const isOverdue = task.deadlineAt && task.deadlineAt < new Date() ? ' ⚠️' : ''

      await ctx.reply(
        `${priorityIcon} **${task.title}**${deadline}${project}${isOverdue}`,
        {
          parse_mode: 'Markdown',
          reply_markup: taskActionsKeyboard(task.id),
        },
      )
    }

    if (sorted.length > 10) {
      await ctx.reply(`...и ещё ${sorted.length - 10} задач`)
    }
  }
}
