'use client'

import { TaskCard, type TaskCardData } from './task-card'

interface TaskListProps {
  tasks: TaskCardData[]
  onToggle?: (id: string, done: boolean) => void
  emptyMessage?: string
  showProject?: boolean
}

export function TaskList({ tasks, onToggle, emptyMessage = 'Задач нет', showProject }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-[var(--tg-theme-hint-color,#9ca3af)]">
        <p className="text-sm">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} onToggle={onToggle} showProject={showProject} />
      ))}
    </div>
  )
}
