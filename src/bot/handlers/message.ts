import { Context } from 'grammy'
import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { parseTasksText } from '@/lib/ai/provider'
import { addPendingTask } from '../services/pending-store'
import { confirmKeyboard, confirmMultiKeyboard } from '../keyboards/task'
import { BotContext } from '../middleware/user'
import { formatTaskPreview } from '../services/format'

/**
 * Обработчик текстовых сообщений.
 * Парсит текст через AI (поддерживает несколько задач), показывает результат с кнопками подтверждения.
 */
export async function handleMessage(ctx: Context) {
  const text = ctx.message?.text
  if (!text) return

  const { dbUser } = ctx as BotContext

  // Получаем проекты пользователя для контекста AI
  const userProjects = await db
    .select({ id: projects.id, name: projects.name, isDefault: projects.isDefault })
    .from(projects)
    .where(eq(projects.userId, dbUser.id))

  const projectNames = userProjects.map((p) => p.name)
  const defaultProject = userProjects.find((p) => p.isDefault) ?? userProjects[0]

  if (!defaultProject) {
    await ctx.reply('Сначала выполни /start для настройки.')
    return
  }

  // AI-парсинг (может вернуть несколько задач)
  const now = new Date()
  const parsedTasks = await parseTasksText(text, {
    currentDate: now.toISOString(),
    timezone: dbUser.timezone,
    projects: projectNames,
  })

  if (parsedTasks.length === 0) {
    await ctx.reply('Не удалось распознать задачи. Попробуй ещё раз.')
    return
  }

  // Сохраняем в pending store
  const pendingIds: string[] = []

  for (const parsed of parsedTasks) {
    let targetProjectId = defaultProject.id
    if (parsed.project) {
      const matched = userProjects.find(
        (p) => p.name.toLowerCase() === parsed.project!.toLowerCase(),
      )
      if (matched) targetProjectId = matched.id
    }

    const pendingId = addPendingTask({
      title: parsed.title,
      description: parsed.description,
      projectId: targetProjectId,
      priority: parsed.priority ?? undefined,
      deadlineAt: parsed.deadlineAt ? new Date(parsed.deadlineAt) : undefined,
      deadlineType: parsed.deadlineType ?? undefined,
      recurrence: parsed.recurrence ?? undefined,
    })

    pendingIds.push(pendingId)
  }

  if (parsedTasks.length === 1) {
    // Одна задача — как обычно
    const parsed = parsedTasks[0]
    const targetProjectId = pendingIds[0]
    let projectId = defaultProject.id
    if (parsed.project) {
      const matched = userProjects.find(
        (p) => p.name.toLowerCase() === parsed.project!.toLowerCase(),
      )
      if (matched) projectId = matched.id
    }
    const targetProject = userProjects.find((p) => p.id === projectId)
    const preview = formatTaskPreview(parsed, targetProject?.name)

    await ctx.reply(preview, {
      parse_mode: 'Markdown',
      reply_markup: confirmKeyboard(pendingIds[0]),
    })
  } else {
    // Несколько задач
    const lines: string[] = [`📋 Распознано задач: **${parsedTasks.length}**\n`]

    for (let i = 0; i < parsedTasks.length; i++) {
      const parsed = parsedTasks[i]
      lines.push(`${i + 1}. **${parsed.title}**`)
      if (parsed.deadlineAt) {
        const date = new Date(parsed.deadlineAt)
        lines.push(
          `   📅 ${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`,
        )
      }
      if (parsed.recurrence) {
        lines.push(`   🔁 ${parsed.recurrence}`)
      }
    }

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: confirmMultiKeyboard(pendingIds),
    })
  }
}
