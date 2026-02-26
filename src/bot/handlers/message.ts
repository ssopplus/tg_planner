import { Context } from 'grammy'
import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { parseTaskText } from '@/lib/ai/provider'
import { addPendingTask } from '../services/pending-store'
import { confirmKeyboard } from '../keyboards/task'
import { BotContext } from '../middleware/user'

/**
 * Обработчик текстовых сообщений.
 * Парсит текст через AI, показывает результат с кнопками подтверждения.
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

  // AI-парсинг
  const now = new Date()
  const parsed = await parseTaskText(text, {
    currentDate: now.toISOString(),
    timezone: dbUser.timezone,
    projects: projectNames,
  })

  // Определяем проект
  let targetProjectId = defaultProject.id
  if (parsed.project) {
    const matched = userProjects.find(
      (p) => p.name.toLowerCase() === parsed.project!.toLowerCase(),
    )
    if (matched) {
      targetProjectId = matched.id
    }
  }

  const targetProject = userProjects.find((p) => p.id === targetProjectId)

  // Сохраняем в pending store
  const pendingId = addPendingTask({
    title: parsed.title,
    description: parsed.description,
    projectId: targetProjectId,
    priority: parsed.priority ?? undefined,
    deadlineAt: parsed.deadlineAt ? new Date(parsed.deadlineAt) : undefined,
    deadlineType: parsed.deadlineType ?? undefined,
  })

  // Формируем сообщение подтверждения
  const lines: string[] = [`📝 **${parsed.title}**`]

  if (parsed.deadlineAt) {
    const date = new Date(parsed.deadlineAt)
    const dateStr = date.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    })
    const typeStr = parsed.deadlineType === 'HARD' ? '(точный)' : '(примерный)'
    lines.push(`📅 Срок: ${dateStr} ${typeStr}`)
  }

  if (parsed.priority && parsed.priority !== 'MEDIUM') {
    const priorityStr = parsed.priority === 'HIGH' ? '🔴 Высокий' : '🟢 Низкий'
    lines.push(`Приоритет: ${priorityStr}`)
  }

  lines.push(`📁 Проект: ${targetProject?.name ?? 'Входящие'}`)

  await ctx.reply(lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: confirmKeyboard(pendingId),
  })
}
