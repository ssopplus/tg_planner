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
import { TaskCard, type TaskCardData } from './task-card'
import { mutateSafely } from '@/lib/api/mutate'

/**
 * Список задач с ручным ранжированием перетаскиванием.
 *
 * Оборачивает обычную TaskCard, а не рисует свою упрощённую разметку —
 * иначе в режиме ранжирования пропали бы бейдж источника (Трекер/Obsidian),
 * «Мой день», подзадачи и режим массового выбора.
 *
 * Порядок отправляется в PATCH /api/tasks/reorder как список id видимых
 * задач; сервер раскладывает их по прежним «слотам», не сдвигая задачи из
 * других разделов (см. докстринг эндпоинта).
 */
interface SortableTaskListProps {
  tasks: TaskCardData[]
  /** Новый порядок для оптимистичного обновления в родителе. */
  onTasksReorder: (tasks: TaskCardData[]) => void
  onToggle?: (id: string, done: boolean) => void
  onMyDayToggle?: (id: string, add: boolean) => void
  selectionMode?: boolean
  selectedIds?: Set<string>
  onSelectionToggle?: (id: string) => void
  onLongPress?: (id: string) => void
}

interface SortableRowProps {
  task: TaskCardData
  onToggle?: (id: string, done: boolean) => void
  onMyDayToggle?: (id: string, add: boolean) => void
  selectionMode?: boolean
  isSelected?: boolean
  onSelectionToggle?: (id: string) => void
  onLongPress?: (id: string) => void
}

function SortableRow({
  task,
  onToggle,
  onMyDayToggle,
  selectionMode,
  isSelected,
  onSelectionToggle,
  onLongPress,
}: SortableRowProps) {
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
      {/* Отступ справа — чтобы ручка не наезжала на содержимое карточки */}
      <div className="pr-9">
        <TaskCard
          task={task}
          onToggle={onToggle}
          onMyDayToggle={onMyDayToggle}
          selectionMode={selectionMode}
          isSelected={isSelected}
          onSelectionToggle={onSelectionToggle}
          onLongPress={onLongPress}
        />
      </div>
      {/* Drag только за ручку: иначе тап по карточке (переход в детали)
          и долгий тап (массовый выбор) конфликтовали бы с перетаскиванием. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 z-20 h-9 w-8 rounded-md flex items-center justify-center text-[var(--tg-theme-hint-color,#8e8e93)]/50 active:bg-[var(--tg-theme-secondary-bg-color,#efeff4)] touch-none"
        aria-label={`Перетащить задачу «${task.title}»`}
      >
        <GripVertical className="h-4 w-4" />
      </button>
    </div>
  )
}

export function SortableTaskList({
  tasks,
  onTasksReorder,
  onToggle,
  onMyDayToggle,
  selectionMode,
  selectedIds,
  onSelectionToggle,
  onLongPress,
}: SortableTaskListProps) {
  const [items, setItems] = useState<TaskCardData[]>(tasks)
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    setItems(tasks)
  }, [tasks])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
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
        url: '/api/tasks/reorder',
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
            <SortableRow
              key={task.id}
              task={task}
              onToggle={onToggle}
              onMyDayToggle={onMyDayToggle}
              selectionMode={selectionMode}
              isSelected={selectedIds?.has(task.id)}
              onSelectionToggle={onSelectionToggle}
              onLongPress={onLongPress}
            />
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
