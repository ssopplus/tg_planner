import { Context } from 'grammy'
import { db } from '@/lib/db'
import { projects, tasks } from '@/lib/db/schema'
import { eq, count } from 'drizzle-orm'
import { BotContext } from '../middleware/user'

/**
 * /projects — список проектов с количеством задач
 */
export async function handleProjects(ctx: Context) {
  const { dbUser } = ctx as BotContext

  const userProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      type: projects.type,
      isDefault: projects.isDefault,
      taskCount: count(tasks.id),
    })
    .from(projects)
    .leftJoin(tasks, eq(tasks.projectId, projects.id))
    .where(eq(projects.userId, dbUser.id))
    .groupBy(projects.id)
    .orderBy(projects.sortOrder)

  if (userProjects.length === 0) {
    await ctx.reply('У тебя пока нет проектов. Они создадутся автоматически при добавлении задач.')
    return
  }

  const lines = userProjects.map((p) => {
    const icon = p.type === 'SHOPPING' ? '🛒' : '📁'
    const def = p.isDefault ? ' (по умолчанию)' : ''
    return `${icon} **${p.name}**${def} — ${p.taskCount} задач`
  })

  await ctx.reply('📂 **Твои проекты:**\n\n' + lines.join('\n'), {
    parse_mode: 'Markdown',
  })
}
