'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Calendar, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TaskCardData {
  id: string
  title: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  deadlineAt: string | null
  deadlineType: string | null
  projectId?: string
  projectName: string | null
  status: string
  subtaskTotal?: number
  subtaskCompleted?: number
}

interface TaskCardProps {
  task: TaskCardData
  onToggle?: (id: string, done: boolean) => void
  draggable?: boolean
  showProject?: boolean
}

export function TaskCard({ task, onToggle, draggable, showProject = true }: TaskCardProps) {
  const isDone = task.status === 'DONE'
  const isOverdue = task.deadlineAt && new Date(task.deadlineAt) < new Date() && !isDone
  const hasSubtasks = (task.subtaskTotal ?? 0) > 0
  const subtaskProgress = hasSubtasks
    ? Math.round(((task.subtaskCompleted ?? 0) / task.subtaskTotal!) * 100)
    : 0

  const priorityVariant = task.priority === 'HIGH' ? 'high' : task.priority === 'LOW' ? 'low' : 'medium'

  return (
    <div className="flex items-start gap-3 rounded-xl bg-[var(--tg-theme-section-bg-color,#fff)] dark:bg-[var(--tg-theme-section-bg-color,#1c1c1e)] p-3">
      {draggable && (
        <GripVertical className="mt-0.5 h-5 w-5 shrink-0 text-[var(--tg-theme-hint-color,#9ca3af)] touch-none cursor-grab" />
      )}

      <Checkbox
        checked={isDone}
        onChange={(checked) => onToggle?.(task.id, checked)}
        className="mt-0.5"
      />

      <Link href={`/tasks/${task.id}`} className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-medium truncate', isDone && 'line-through opacity-50')}>
            {task.title}
          </span>
          <Badge variant={priorityVariant} className="shrink-0">
            {task.priority === 'HIGH' ? 'Высокий' : task.priority === 'LOW' ? 'Низкий' : 'Средний'}
          </Badge>
        </div>

        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--tg-theme-hint-color,#9ca3af)]">
          {task.deadlineAt && (
            <span className={cn('flex items-center gap-1', isOverdue && 'text-red-500')}>
              <Calendar className="h-3 w-3" />
              {new Date(task.deadlineAt).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'short',
              })}
            </span>
          )}
          {showProject && task.projectName && <span>📁 {task.projectName}</span>}
          {hasSubtasks && (
            <span>
              ✓ {task.subtaskCompleted}/{task.subtaskTotal}
            </span>
          )}
        </div>

        {hasSubtasks && <Progress value={subtaskProgress} className="mt-2" />}
      </Link>
    </div>
  )
}
