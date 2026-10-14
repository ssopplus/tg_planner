'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { hapticImpact } from '@/lib/telegram/webapp'
import { columnForDue, formatDue, DUE_COLUMNS, type DueColumn } from '@/lib/boards/due-dates'

export interface BoardTask {
  id: string
  title: string
  body: string | null
  dueDate: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'ARCHIVED'
  boardId?: string | null
}

/** Доска, с которой пришло дело: нужна только для подписи на карточке. */
export interface BoardMeta {
  name: string
  emoji: string | null
}

/**
 * Доска личных дел: колонки — сроки.
 *
 * Перетаскивание включается по удержанию, а не по сдвигу: доска листается
 * горизонтально, и свайп по карточке должен прокручивать её, а не таскать
 * дело. Мышь работает сразу — там конфликта с прокруткой нет.
 */
export function DueBoard({
  tasks,
  today,
  onMove,
  onToggle,
  boards,
}: {
  tasks: BoardTask[]
  today: string
  onMove: (taskId: string, column: DueColumn) => void
  onToggle: (taskId: string, done: boolean) => void
  /**
   * Карта досок для подписи на карточке. Передаётся только в режиме «Все»:
   * внутри одной доски подпись у всех карточек одинаковая и лишь шумит.
   */
  boards?: Record<string, BoardMeta>
}) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null

  function handleDragStart(event: DragStartEvent) {
    // Палец закрывает карточку собой: вибрация — единственный честный сигнал,
    // что удержание засчитано и дальше пойдёт перетаскивание.
    hapticImpact('medium')
    setActiveId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return

    const column = over.id as DueColumn
    const task = tasks.find((t) => t.id === active.id)
    if (!task) return
    if (columnForDue(task.dueDate, today) === column) return

    onMove(task.id, column)
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto px-4 pb-4 max-sm:snap-x">
        {DUE_COLUMNS.map((column) => (
          <Column
            key={column.id}
            id={column.id}
            title={column.title}
            tasks={tasks.filter((t) => columnForDue(t.dueDate, today) === column.id)}
            today={today}
            onToggle={onToggle}
            boards={boards}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="rotate-2 scale-105 rounded-xl shadow-2xl ring-2 ring-[var(--tg-theme-button-color,#007aff)]">
            <TaskBody task={activeTask} today={today} boards={boards} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function Column({
  id,
  title,
  tasks,
  today,
  onToggle,
  boards,
}: {
  id: DueColumn
  title: string
  tasks: BoardTask[]
  today: string
  onToggle: (taskId: string, done: boolean) => void
  boards?: Record<string, BoardMeta>
}) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <section
      ref={setNodeRef}
      className={`flex w-[78vw] max-w-[280px] shrink-0 snap-start flex-col gap-2 rounded-xl p-2 transition-colors sm:w-[240px] ${
        isOver
          ? 'bg-[var(--tg-theme-button-color,#007aff)]/10'
          : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)]'
      }`}
    >
      <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--tg-theme-hint-color,#8e8e93)]">
        {title}
        {tasks.length ? <span className="ml-1.5 opacity-70">{tasks.length}</span> : null}
      </h2>

      {tasks.map((task) => (
        <DraggableCard
          key={task.id}
          task={task}
          today={today}
          onToggle={onToggle}
          boards={boards}
        />
      ))}

      {tasks.length === 0 ? (
        <p className="px-1 py-3 text-[12px] text-[var(--tg-theme-hint-color,#8e8e93)]">
          Перетащите дело сюда
        </p>
      ) : null}
    </section>
  )
}

function DraggableCard({
  task,
  today,
  onToggle,
  boards,
}: {
  task: BoardTask
  today: string
  onToggle: (taskId: string, done: boolean) => void
  boards?: Record<string, BoardMeta>
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`touch-manipulation transition-opacity ${isDragging ? 'opacity-30' : ''}`}
    >
      <TaskBody task={task} today={today} onToggle={onToggle} boards={boards} />
    </div>
  )
}

function TaskBody({
  task,
  today,
  onToggle,
  boards,
}: {
  task: BoardTask
  today: string
  onToggle?: (taskId: string, done: boolean) => void
  boards?: Record<string, BoardMeta>
}) {
  const due = formatDue(task.dueDate, today)
  const overdue = task.dueDate ? task.dueDate < today : false
  const done = task.status === 'DONE'
  const board = boards && task.boardId ? boards[task.boardId] : undefined

  return (
    <div className="rounded-lg border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-2.5">
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={done ? 'Вернуть в работу' : 'Отметить выполненным'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggle?.(task.id, !done)
          }}
          className={`mt-0.5 h-[18px] w-[18px] shrink-0 rounded-[5px] border-2 transition-colors ${
            done
              ? 'border-[var(--tg-theme-button-color,#007aff)] bg-[var(--tg-theme-button-color,#007aff)]'
              : 'border-[var(--tg-theme-hint-color,#8e8e93)]'
          }`}
        />

        <Link href={`/boards/task/${task.id}`} className="min-w-0 flex-1">
          <p
            className={`text-[13px] leading-snug ${
              done
                ? 'text-[var(--tg-theme-hint-color,#8e8e93)] line-through'
                : 'text-[var(--tg-theme-text-color,#000)]'
            }`}
          >
            {task.title}
          </p>

          {task.body ? (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--tg-theme-hint-color,#8e8e93)]">
              {task.body}
            </p>
          ) : null}

          {due || board ? (
            <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
              {due ? (
                <span
                  className={
                    overdue
                      ? 'text-[var(--tg-theme-destructive-text-color,#d1453b)]'
                      : 'text-[var(--tg-theme-hint-color,#8e8e93)]'
                  }
                >
                  {due}
                </span>
              ) : null}

              {board ? (
                <span className="rounded-full bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-1.5 py-px text-[var(--tg-theme-hint-color,#8e8e93)]">
                  {board.emoji ? `${board.emoji} ` : ''}
                  {board.name}
                </span>
              ) : null}
            </span>
          ) : null}
        </Link>
      </div>
    </div>
  )
}
