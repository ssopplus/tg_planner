'use client'

import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TaskCard, type TaskCardData } from './task-card'
import { GripVertical } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

interface SortableTaskListProps {
  tasks: TaskCardData[]
  onReorder: (ids: string[]) => void
  onToggle?: (id: string, done: boolean) => void
}

function SortableItem({
  task,
  onToggle,
}: {
  task: TaskCardData
  onToggle?: (id: string, done: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const isDone = task.status === 'DONE'
  const isOverdue = task.deadlineAt && new Date(task.deadlineAt) < new Date() && !isDone
  const hasSubtasks = (task.subtaskTotal ?? 0) > 0
  const subtaskProgress = hasSubtasks
    ? Math.round(((task.subtaskCompleted ?? 0) / task.subtaskTotal!) * 100)
    : 0
  const priorityVariant = task.priority === 'HIGH' ? 'high' : task.priority === 'LOW' ? 'low' : 'medium'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-3 rounded-xl bg-[var(--tg-theme-section-bg-color,#fff)] dark:bg-[var(--tg-theme-section-bg-color,#1c1c1e)] p-3"
    >
      <div {...attributes} {...listeners} className="touch-none cursor-grab mt-0.5">
        <GripVertical className="h-5 w-5 text-[var(--tg-theme-hint-color,#9ca3af)]" />
      </div>

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
            {task.priority === 'HIGH' ? '!' : task.priority === 'LOW' ? '↓' : '—'}
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
          {task.projectName && <span>📁 {task.projectName}</span>}
          {hasSubtasks && <span>✓ {task.subtaskCompleted}/{task.subtaskTotal}</span>}
        </div>
        {hasSubtasks && <Progress value={subtaskProgress} className="mt-2" />}
      </Link>
    </div>
  )
}

export function SortableTaskList({ tasks, onReorder, onToggle }: SortableTaskListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = tasks.findIndex((t) => t.id === active.id)
    const newIndex = tasks.findIndex((t) => t.id === over.id)
    const reordered = arrayMove(tasks, oldIndex, newIndex)
    onReorder(reordered.map((t) => t.id))
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-[var(--tg-theme-hint-color,#9ca3af)]">
        <p className="text-sm">Задач на сегодня нет</p>
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <SortableItem key={task.id} task={task} onToggle={onToggle} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
