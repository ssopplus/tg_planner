'use client'

import Link from 'next/link'
import { Calendar, ChevronRight, Sun } from 'lucide-react'

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
  myDayDate?: string | null
}

interface TaskCardProps {
  task: TaskCardData
  onToggle?: (id: string, done: boolean) => void
  onMyDayToggle?: (id: string, add: boolean) => void
  showProject?: boolean
}

const priorityConfig = {
  HIGH: { label: 'Высокий', className: 'bg-red-500/15 text-red-600' },
  MEDIUM: { label: 'Средний', className: 'bg-orange-500/15 text-orange-600' },
  LOW: { label: 'Низкий', className: 'bg-green-500/15 text-green-600' },
}

function isOverdue(deadline: string | null, isDone: boolean): boolean {
  if (!deadline || isDone) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(deadline) < today
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)

  if (d.getTime() === today.getTime()) return 'Сегодня'
  if (d.getTime() === tomorrow.getTime()) return 'Завтра'

  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function checkMyDay(task: TaskCardData): { inMyDay: boolean; isManual: boolean } {
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const isDone = task.status === 'DONE'

  // Вручную добавлена
  if (task.myDayDate === todayStr) return { inMyDay: true, isManual: true }

  // Автоматически: дедлайн сегодня или просрочено
  if (task.deadlineAt && !isDone) {
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59)
    if (new Date(task.deadlineAt) <= endOfDay) return { inMyDay: true, isManual: false }
  }

  // Автоматически: HIGH приоритет без дедлайна
  if (task.priority === 'HIGH' && !task.deadlineAt && !isDone) return { inMyDay: true, isManual: false }

  return { inMyDay: false, isManual: false }
}

export function TaskCard({ task, onToggle, onMyDayToggle, showProject = true }: TaskCardProps) {
  const isDone = task.status === 'DONE'
  const priority = priorityConfig[task.priority]
  const overdue = isOverdue(task.deadlineAt, isDone)
  const hasSubtasks = (task.subtaskTotal ?? 0) > 0
  const { inMyDay, isManual } = checkMyDay(task)

  return (
    <div className="bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="flex items-start gap-3">
        {/* Круглый чекбокс */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggle?.(task.id, !isDone)
          }}
          className={`mt-0.5 flex-shrink-0 h-5 w-5 rounded-full border-2 transition-all ${
            isDone
              ? 'bg-[var(--tg-theme-button-color,#007aff)] border-[var(--tg-theme-button-color,#007aff)]'
              : 'border-[var(--tg-theme-hint-color,#8e8e93)]'
          } flex items-center justify-center`}
          aria-label={isDone ? 'Отметить как невыполненное' : 'Отметить как выполненное'}
        >
          {isDone && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path
                d="M1 4L3.5 6.5L9 1"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        {/* Контент */}
        <Link href={`/tasks/${task.id}`} className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[15px] font-medium leading-snug ${
                isDone
                  ? 'line-through text-[var(--tg-theme-hint-color,#8e8e93)]'
                  : 'text-[var(--tg-theme-text-color,#000)]'
              }`}
            >
              {task.title}
            </span>
            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${priority.className}`}>
              {priority.label}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {task.deadlineAt && (
              <span
                className={`flex items-center gap-1 text-xs ${overdue ? 'text-red-500 font-medium' : 'text-[var(--tg-theme-hint-color,#8e8e93)]'}`}
              >
                <Calendar className="h-3 w-3" />
                {formatDate(task.deadlineAt)}
              </span>
            )}
            {showProject && task.projectName && (
              <span className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)]">
                {task.projectName}
              </span>
            )}
            {hasSubtasks && (
              <span className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)]">
                {task.subtaskCompleted}/{task.subtaskTotal}
              </span>
            )}
          </div>
        </Link>

        {/* Иконка «Мой день» */}
        {onMyDayToggle && (
          inMyDay && !isManual ? (
            /* Авто-добавлена (дедлайн/приоритет) — не убрать */
            <div className="flex-shrink-0 mt-0.5 p-1 -m-1">
              <Sun className="h-4.5 w-4.5 text-amber-400/60 fill-amber-400/60" />
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onMyDayToggle(task.id, !inMyDay)
              }}
              className="flex-shrink-0 mt-0.5 p-1 -m-1 active:scale-90 transition-transform"
              aria-label={inMyDay ? 'Убрать из «Мой день»' : 'Добавить в «Мой день»'}
            >
              <Sun
                className={`h-4.5 w-4.5 transition-colors ${
                  inMyDay
                    ? 'text-amber-500 fill-amber-500'
                    : 'text-[var(--tg-theme-hint-color,#8e8e93)]'
                }`}
              />
            </button>
          )
        )}

        {/* Шеврон */}
        <Link href={`/tasks/${task.id}`} className="flex-shrink-0 mt-1">
          <ChevronRight className="h-4 w-4 text-[var(--tg-theme-hint-color,#8e8e93)]" />
        </Link>
      </div>
    </div>
  )
}
