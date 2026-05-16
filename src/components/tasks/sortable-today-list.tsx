'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { SwipeableTaskCard } from './swipeable-task-card'
import { TaskCard, type TaskCardData } from './task-card'
import { mutateSafely } from '@/lib/api/mutate'

interface SortableTodayListProps {
  tasks: TaskCardData[]
  onTasksReorder: (tasks: TaskCardData[]) => void
  onComplete?: (id: string) => void
  onRemove?: (id: string) => void
}

interface SortableRowProps {
  task: TaskCardData
  onComplete?: (id: string) => void
  onRemove?: (id: string) => void
}

function SortableRow({ task, onComplete, onRemove }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="relative">
      <SwipeableTaskCard task={task} onComplete={onComplete} onRemove={onRemove} />
      {/* Drag-handle: длинное нажатие активирует drag, чтобы не конфликтовать со swipe */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute right-2 top-1/2 -translate-y-1/2 z-20 h-8 w-8 rounded-md flex items-center justify-center text-[var(--tg-theme-hint-color,#8e8e93)]/40 active:bg-[var(--tg-theme-secondary-bg-color,#efeff4)] touch-none"
        aria-label="Перетащить"
      >
        <GripVertical className="h-4 w-4" />
      </button>
    </div>
  )
}

export function SortableTodayList({
  tasks,
  onTasksReorder,
  onComplete,
  onRemove,
}: SortableTodayListProps) {
  const [items, setItems] = useState<TaskCardData[]>(tasks)
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    setItems(tasks)
  }, [tasks])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Длинное нажатие 250мс активирует drag — не конфликтует со swipe-жестами
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }, [])

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveId(null)
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIndex = items.findIndex((t) => t.id === active.id)
      const newIndex = items.findIndex((t) => t.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = arrayMove(items, oldIndex, newIndex)
      const snapshot = items
      setItems(reordered)
      onTasksReorder(reordered)

      await mutateSafely({
        method: 'PATCH',
        url: '/api/today',
        body: { ids: reordered.map((t) => t.id) },
        label: 'Изменение порядка задач',
        onRollback: () => {
          setItems(snapshot)
          onTasksReorder(snapshot)
        },
      })
    },
    [items, onTasksReorder],
  )

  const activeTask = activeId ? items.find((t) => t.id === activeId) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2">
          {items.map((task) => (
            <SortableRow key={task.id} task={task} onComplete={onComplete} onRemove={onRemove} />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeTask ? (
          <div className="opacity-90 shadow-lg rounded-xl">
            <TaskCard task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
