'use client'

import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { TaskCard, type TaskCardData } from './task-card'

type Status = 'TODO' | 'IN_PROGRESS' | 'DONE'

const columns: { status: Status; title: string; color: string }[] = [
  { status: 'TODO', title: 'Сделать', color: 'bg-blue-500' },
  { status: 'IN_PROGRESS', title: 'В работе', color: 'bg-orange-500' },
  { status: 'DONE', title: 'Готово', color: 'bg-green-500' },
]

interface KanbanBoardProps {
  tasks: TaskCardData[]
  onStatusChange: (id: string, status: string) => void
  onToggle: (id: string, done: boolean) => void
}

function DraggableCard({
  task,
  onToggle,
}: {
  task: TaskCardData
  onToggle: (id: string, done: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
  })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`touch-none ${isDragging ? 'opacity-30' : ''}`}
    >
      <TaskCard task={task} onToggle={onToggle} />
    </div>
  )
}

function DroppableColumn({
  status,
  title,
  color,
  tasks,
  onToggle,
}: {
  status: Status
  title: string
  color: string
  tasks: TaskCardData[]
  onToggle: (id: string, done: boolean) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })

  return (
    <div
      ref={setNodeRef}
      className={`w-[80vw] flex-shrink-0 snap-center sm:w-auto sm:flex-1 rounded-xl p-3 transition-colors ${
        isOver
          ? 'bg-[var(--tg-theme-button-color,#007aff)]/10'
          : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)]'
      }`}
    >
      {/* Заголовок колонки */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className={`h-2.5 w-2.5 rounded-full ${color}`} />
        <span className="text-sm font-semibold text-[var(--tg-theme-text-color,#000)]">
          {title}
        </span>
        <span className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)] ml-auto">
          {tasks.length}
        </span>
      </div>

      {/* Карточки */}
      <div className="flex flex-col gap-2 min-h-[100px]">
        {tasks.map((task) => (
          <DraggableCard key={task.id} task={task} onToggle={onToggle} />
        ))}
        {tasks.length === 0 && (
          <div className="flex items-center justify-center h-20 rounded-lg border-2 border-dashed border-[var(--tg-theme-hint-color,#8e8e93)]/20 text-xs text-[var(--tg-theme-hint-color,#8e8e93)]">
            Перетащите сюда
          </div>
        )}
      </div>
    </div>
  )
}

export function KanbanBoard({ tasks, onStatusChange, onToggle }: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const tasksByStatus = (status: Status) => tasks.filter((t) => t.status === status)

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return

    const taskId = active.id as string
    const newStatus = over.id as string
    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === newStatus) return

    onStatusChange(taskId, newStatus)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-4 px-4 sm:px-4">
        {columns.map((col) => (
          <DroppableColumn
            key={col.status}
            status={col.status}
            title={col.title}
            color={col.color}
            tasks={tasksByStatus(col.status)}
            onToggle={onToggle}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="opacity-80 rotate-2 scale-105">
            <TaskCard task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
