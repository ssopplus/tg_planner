/**
 * Сборка AI-промта для dev-задачи. Чистая функция без побочных эффектов:
 * принимает данные задачи + проекта, отдаёт строку, которую можно
 * скопировать в Claude Code / Cursor / другой агент.
 *
 * Что входит в промт:
 * - заголовок задачи и описание;
 * - подзадачи (если есть) — это план реализации, который агенту полезно
 *   прочитать как чек-лист;
 * - имя проекта и его репо-путь (агент сразу знает, в какой папке работать);
 * - стек технологий (помогает понимать, какие инструменты использовать);
 * - описание проекта из vault (даёт высокоуровневый контекст);
 * - дедлайн (если задан) — намекает на бюджет внимания.
 *
 * Поля, которых нет, пропускаются молча. Это нужно, чтобы промт остался
 * читаемым в случае задач из лёгких проектов без полной заметки в vault.
 */

export interface DevTaskPromptInput {
  task: {
    title: string
    description: string | null
    deadlineAt: Date | string | null
    deadlineType: string | null
    subtasks: Array<{ title: string; isCompleted: boolean }>
  }
  project: {
    name: string
    slug: string | null
    description: string | null
    techStack: string[] | null
    repoPath: string | null
  }
}

function formatDeadline(deadlineAt: Date | string | null, type: string | null): string | null {
  if (!deadlineAt) return null
  const date = typeof deadlineAt === 'string' ? new Date(deadlineAt) : deadlineAt
  const dateStr = date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const typeLabel = type === 'HARD' ? 'жёсткий' : type === 'SOFT' ? 'мягкий' : null
  return typeLabel ? `${dateStr} (${typeLabel})` : dateStr
}

export function buildDevTaskPrompt(input: DevTaskPromptInput): string {
  const { task, project } = input
  const lines: string[] = []

  lines.push(`# Задача: ${task.title}`)
  lines.push('')
  lines.push(`Проект: ${project.name}${project.slug ? ` (${project.slug})` : ''}`)
  if (project.repoPath) lines.push(`Путь к репозиторию: ${project.repoPath}`)
  if (project.techStack?.length) lines.push(`Стек: ${project.techStack.join(', ')}`)

  const deadline = formatDeadline(task.deadlineAt, task.deadlineType)
  if (deadline) lines.push(`Дедлайн: ${deadline}`)

  if (task.description?.trim()) {
    lines.push('')
    lines.push('## Описание задачи')
    lines.push(task.description.trim())
  }

  if (task.subtasks.length > 0) {
    lines.push('')
    lines.push('## Подзадачи (план)')
    for (const sub of task.subtasks) {
      lines.push(`- [${sub.isCompleted ? 'x' : ' '}] ${sub.title}`)
    }
  }

  if (project.description?.trim()) {
    lines.push('')
    lines.push('## Контекст проекта')
    lines.push(project.description.trim())
  }

  lines.push('')
  lines.push('---')
  lines.push(
    'Прочитай контекст выше, потом займись задачей. Если нужно дополнительное' +
      ' уточнение — задай вопрос; не строй догадок про код, которого не видел.',
  )

  return lines.join('\n')
}
