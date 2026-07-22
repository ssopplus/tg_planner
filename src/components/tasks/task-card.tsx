'use client'

import { useState, useCallback, useRef, type MouseEvent } from 'react'
import Link from 'next/link'
import { Calendar, ChevronRight, Sun, ChevronDown, FileText, Inbox } from 'lucide-react'
import { TrackerLogo } from '@/components/ui/tracker-logo'
import { apiFetch } from '@/lib/telegram/webapp'
import { mutateSafely } from '@/lib/api/mutate'

export interface TaskCardData {
  id: string
  title: string
  description?: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  deadlineAt: string | null
  deadlineType: string | null
  projectId?: string
  projectName: string | null
  status: string
  subtaskTotal?: number
  subtaskCompleted?: number
  myDayDate?: string | null
  externalSource?: string | null
  externalId?: string | null
  vaultPath?: string | null
}

interface Subtask {
  id: string
  taskId: string
  title: string
  isCompleted: boolean
  sortOrder: number
}

interface TaskCardProps {
  task: TaskCardData
  onToggle?: (id: string, done: boolean) => void
  onMyDayToggle?: (id: string, add: boolean) => void
  showProject?: boolean
  /** Режим массового выбора: карточка не ведёт в детали, тап тогглит выбор. */
  selectionMode?: boolean
  isSelected?: boolean
  onSelectionToggle?: (id: string) => void
  /** Долгий тап (600мс) — включить selectionMode и выбрать эту задачу. */
  onLongPress?: (id: string) => void
}

const priorityConfig = {
  HIGH: { label: 'Высокий', className: 'bg-red-500/15 text-red-600' },
  MEDIUM: { label: 'Средний', className: 'bg-orange-500/15 text-orange-600' },
  LOW: { label: 'Низкий', className: 'bg-green-500/15 text-green-600' },
}

/**
 * Маленький бейдж источника задачи: трекер / vault / ручная.
 * Для YT/Obsidian — кликабельный: открывает тикет в Yandex Tracker
 * или файл vault в Obsidian через obsidian://open URL-scheme.
 */
function TaskSourceBadge({ task }: { task: TaskCardData }) {
  const stop = (e: MouseEvent) => e.stopPropagation()
  const badgeCls =
    'inline-flex items-center gap-1 text-xs text-[var(--tg-theme-hint-color,#8e8e93)] hover:text-[var(--tg-theme-link-color,#007aff)] transition-colors'

  if (task.externalSource === 'yandex-tracker' && task.externalId) {
    const url = `https://tracker.yandex.ru/${task.externalId}`
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stop}
        className={badgeCls}
        title={`Открыть в Yandex Tracker: ${task.externalId}`}
      >
        <TrackerLogo className="h-3 w-3" />
        {task.externalId}
      </a>
    )
  }
  if (task.vaultPath) {
    // Obsidian URL scheme: obsidian://open?vault=<name>&file=<encoded relative path>
    // Наш vault лежит по пути Документация/, полный путь = task.vaultPath как есть.
    const url = `obsidian://open?vault=${encodeURIComponent('Документация')}&file=${encodeURIComponent(task.vaultPath)}`
    return (
      <a href={url} onClick={stop} className={badgeCls} title={`Открыть в Obsidian: ${task.vaultPath}`}>
        <FileText className="h-3 w-3" />
        Obsidian
      </a>
    )
  }
  return (
    <span className={badgeCls} title="Создана вручную">
      <Inbox className="h-3 w-3" />
      Бот
    </span>
  )
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

export function TaskCard({
  task,
  onToggle,
  onMyDayToggle,
  showProject = true,
  selectionMode = false,
  isSelected = false,
  onSelectionToggle,
  onLongPress,
}: TaskCardProps) {
  const isDone = task.status === 'DONE'
  const priority = priorityConfig[task.priority]
  const overdue = isOverdue(task.deadlineAt, isDone)
  const hasSubtasks = (task.subtaskTotal ?? 0) > 0
  const { inMyDay, isManual } = checkMyDay(task)

  // Long-press: 600мс удержания пальца/мыши → onLongPress. Отслеживаем через
  // ref, чтобы cleanup работал даже если onLongPress меняется между рендерами.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)
  const startLongPress = useCallback(() => {
    if (!onLongPress) return
    longPressFired.current = false
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      onLongPress(task.id)
    }, 600)
  }, [onLongPress, task.id])
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const [expanded, setExpanded] = useState(false)
  const [subtaskList, setSubtaskList] = useState<Subtask[] | null>(null)
  const [loading, setLoading] = useState(false)
  // Локальный счётчик «выполнено / всего». Обновляется при тоггле подзадач,
  // чтобы UI шапки не ждал повторного fetch.
  const [completed, setCompleted] = useState(task.subtaskCompleted ?? 0)
  const total = task.subtaskTotal ?? 0

  const toggleExpand = useCallback(
    async (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const next = !expanded
      setExpanded(next)
      if (next && subtaskList === null) {
        setLoading(true)
        try {
          const res = await apiFetch(`/api/tasks/${task.id}/subtasks`)
          if (res.ok) {
            const data = (await res.json()) as Subtask[]
            setSubtaskList(data)
            setCompleted(data.filter((s) => s.isCompleted).length)
          }
        } finally {
          setLoading(false)
        }
      }
    },
    [expanded, subtaskList, task.id],
  )

  const toggleSubtask = useCallback(
    async (subId: string, newCompleted: boolean) => {
      if (!subtaskList) return
      const snapshot = subtaskList
      const optimistic = subtaskList.map((s) =>
        s.id === subId ? { ...s, isCompleted: newCompleted } : s,
      )
      setSubtaskList(optimistic)
      setCompleted(optimistic.filter((s) => s.isCompleted).length)

      await mutateSafely({
        method: 'PATCH',
        url: `/api/subtasks/${subId}`,
        body: { isCompleted: newCompleted },
        label: newCompleted ? 'Отметка подзадачи выполненной' : 'Снятие отметки подзадачи',
        onRollback: () => {
          setSubtaskList(snapshot)
          setCompleted(snapshot.filter((s) => s.isCompleted).length)
        },
      })
    },
    [subtaskList],
  )

  // Клик по карточке в режиме выбора — тоггл, обычная навигация не срабатывает
  // из-за conditional-обёртки ниже (<div> вместо <Link>).
  const handleContentClick = useCallback(
    (e: MouseEvent) => {
      if (longPressFired.current) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (selectionMode) {
        e.preventDefault()
        e.stopPropagation()
        onSelectionToggle?.(task.id)
      }
    },
    [selectionMode, onSelectionToggle, task.id],
  )

  return (
    <div
      className={`rounded-xl px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition-colors ${
        isSelected
          ? 'bg-[var(--tg-theme-button-color,#007aff)]/10 ring-2 ring-[var(--tg-theme-button-color,#007aff)]'
          : 'bg-[var(--tg-theme-section-bg-color,#fff)]'
      }`}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
    >
      <div className="flex items-start gap-3">
        {/* Круглый чекбокс. В режиме выбора выступает индикатором selected. */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (selectionMode) {
              onSelectionToggle?.(task.id)
            } else {
              onToggle?.(task.id, !isDone)
            }
          }}
          className={`mt-0.5 flex-shrink-0 h-5 w-5 rounded-full border-2 transition-all ${
            selectionMode
              ? isSelected
                ? 'bg-[var(--tg-theme-button-color,#007aff)] border-[var(--tg-theme-button-color,#007aff)]'
                : 'border-[var(--tg-theme-button-color,#007aff)]'
              : isDone
                ? 'bg-[var(--tg-theme-button-color,#007aff)] border-[var(--tg-theme-button-color,#007aff)]'
                : 'border-[var(--tg-theme-hint-color,#8e8e93)]'
          } flex items-center justify-center`}
          aria-label={
            selectionMode
              ? isSelected
                ? 'Убрать из выбора'
                : 'Выбрать'
              : isDone
                ? 'Отметить как невыполненное'
                : 'Отметить как выполненное'
          }
        >
          {(selectionMode ? isSelected : isDone) && (
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

        {/* Контент. В режиме выбора — div (тап тогглит выбор), иначе Link. */}
        {(() => {
          const inner = (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[15px] font-medium leading-snug break-words min-w-0 ${
                    isDone
                      ? 'line-through text-[var(--tg-theme-hint-color,#8e8e93)]'
                      : 'text-[var(--tg-theme-text-color,#000)]'
                  }`}
                >
                  {task.title}
                </span>
                <span
                  className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${priority.className}`}
                >
                  {priority.label}
                </span>
              </div>
              {task.description && (
                <p
                  className={`text-[13px] leading-snug mt-0.5 line-clamp-1 break-words text-[var(--tg-theme-hint-color,#8e8e93)] ${
                    isDone ? 'opacity-60' : ''
                  }`}
                >
                  {task.description}
                </p>
              )}
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <TaskSourceBadge task={task} />
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
                  <button
                    type="button"
                    onClick={toggleExpand}
                    className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)] flex items-center gap-0.5 px-1 -mx-1 rounded active:bg-[var(--tg-theme-secondary-bg-color,#efeff4)]"
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Свернуть подзадачи' : 'Раскрыть подзадачи'}
                  >
                    <span>
                      {completed}/{total}
                    </span>
                    <ChevronDown
                      className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                  </button>
                )}
              </div>
            </>
          )
          return selectionMode ? (
            <div className="flex-1 min-w-0 cursor-pointer" onClick={handleContentClick}>
              {inner}
            </div>
          ) : (
            <Link href={`/tasks/${task.id}`} className="flex-1 min-w-0" onClick={handleContentClick}>
              {inner}
            </Link>
          )
        })()}

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

        {/* Шеврон — прячем в режиме выбора, иначе тап уводит с /tasks. */}
        {!selectionMode && (
          <Link href={`/tasks/${task.id}`} className="flex-shrink-0 mt-1">
            <ChevronRight className="h-4 w-4 text-[var(--tg-theme-hint-color,#8e8e93)]" />
          </Link>
        )}
      </div>

      {expanded && hasSubtasks && (
        <div className="mt-2.5 ml-8 pt-2 border-t border-[var(--tg-theme-hint-color,#8e8e93)]/10 flex flex-col gap-1.5">
          {loading && (
            <div className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)] py-1">Загрузка…</div>
          )}
          {!loading &&
            subtaskList?.map((sub) => (
              <button
                key={sub.id}
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void toggleSubtask(sub.id, !sub.isCompleted)
                }}
                className="flex items-center gap-2 text-left py-1 -mx-1 px-1 rounded active:bg-[var(--tg-theme-secondary-bg-color,#efeff4)]"
              >
                <span
                  className={`flex-shrink-0 h-4 w-4 rounded border-2 flex items-center justify-center transition-all ${
                    sub.isCompleted
                      ? 'bg-[var(--tg-theme-button-color,#007aff)] border-[var(--tg-theme-button-color,#007aff)]'
                      : 'border-[var(--tg-theme-hint-color,#8e8e93)]'
                  }`}
                >
                  {sub.isCompleted && (
                    <svg width="8" height="6" viewBox="0 0 10 8" fill="none">
                      <path
                        d="M1 4L3.5 6.5L9 1"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span
                  className={`text-[13px] leading-tight ${
                    sub.isCompleted
                      ? 'line-through text-[var(--tg-theme-hint-color,#8e8e93)]'
                      : 'text-[var(--tg-theme-text-color,#000)]'
                  }`}
                >
                  {sub.title}
                </span>
              </button>
            ))}
          {!loading && subtaskList?.length === 0 && (
            <div className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)] py-1">
              Подзадач нет
            </div>
          )}
        </div>
      )}
    </div>
  )
}
