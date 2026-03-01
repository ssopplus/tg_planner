import { ParsedTask } from '@/lib/ai/types'

/**
 * Формирует текстовое превью распарсенной задачи для подтверждения.
 */
export function formatTaskPreview(parsed: ParsedTask, projectName?: string): string {
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

  if (parsed.recurrence) {
    lines.push(`🔁 Повторение: ${parsed.recurrence}`)
  }

  lines.push(`📁 Проект: ${projectName ?? 'Входящие'}`)

  return lines.join('\n')
}

/**
 * Форматирует задачу из БД для отображения в списке.
 */
export function formatTaskLine(task: {
  title: string
  priority: string
  deadlineAt: Date | null
  projectName: string | null
}): string {
  const priorityIcon = task.priority === 'HIGH' ? '🔴' : task.priority === 'MEDIUM' ? '🟡' : '🟢'
  const deadline = task.deadlineAt
    ? ` | 📅 ${task.deadlineAt.toLocaleDateString('ru-RU')}`
    : ''
  const project = task.projectName ? ` | 📁 ${task.projectName}` : ''

  return `${priorityIcon} **${task.title}**${deadline}${project}`
}
