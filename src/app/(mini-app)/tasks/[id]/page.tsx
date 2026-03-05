'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Calendar, Trash2, Check, Plus, X, FolderOpen } from 'lucide-react'
import { apiFetch } from '@/lib/telegram/webapp'

interface Subtask {
  id: string
  title: string
  isCompleted: boolean
  sortOrder: number
}

interface TaskDetail {
  id: string
  title: string
  description: string | null
  priority: string
  status: string
  deadlineAt: string | null
  deadlineType: string | null
  projectName: string | null
  projectId: string
  createdAt: string
  completedAt: string | null
  subtasks: Subtask[]
}

const priorityConfig: Record<string, { label: string; className: string }> = {
  HIGH: { label: 'Высокий', className: 'bg-red-500/15 text-red-600' },
  MEDIUM: { label: 'Средний', className: 'bg-orange-500/15 text-orange-600' },
  LOW: { label: 'Низкий', className: 'bg-green-500/15 text-green-600' },
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export default function TaskDetailPage() {
  const params = useParams()
  const router = useRouter()
  const taskId = params.id as string
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [newSubtask, setNewSubtask] = useState('')

  const fetchTask = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/tasks/${taskId}`)
      if (res.ok) setTask(await res.json())
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    fetchTask()
  }, [fetchTask])

  const handleComplete = useCallback(async () => {
    if (!task) return
    const newStatus = task.status === 'DONE' ? 'TODO' : 'DONE'
    setTask({ ...task, status: newStatus })
    await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    })
  }, [task, taskId])

  const handleDelete = useCallback(async () => {
    await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
    router.back()
  }, [taskId, router])

  const handleSubtaskToggle = useCallback(
    async (subtaskId: string, isCompleted: boolean) => {
      if (!task) return
      setTask({
        ...task,
        subtasks: task.subtasks.map((s) => (s.id === subtaskId ? { ...s, isCompleted } : s)),
      })
      await apiFetch(`/api/subtasks/${subtaskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isCompleted }),
      })
    },
    [task],
  )

  const handleAddSubtask = useCallback(async () => {
    if (!newSubtask.trim() || !task) return
    const res = await apiFetch(`/api/tasks/${taskId}/subtasks`, {
      method: 'POST',
      body: JSON.stringify({ title: newSubtask.trim() }),
    })
    if (res.ok) {
      const created = await res.json()
      setTask({ ...task, subtasks: [...task.subtasks, created] })
      setNewSubtask('')
    }
  }, [newSubtask, task, taskId])

  const handleDeleteSubtask = useCallback(
    async (subtaskId: string) => {
      if (!task) return
      setTask({ ...task, subtasks: task.subtasks.filter((s) => s.id !== subtaskId) })
      await apiFetch(`/api/subtasks/${subtaskId}`, { method: 'DELETE' })
    },
    [task],
  )

  if (loading) {
    return (
      <div className="bg-[var(--tg-theme-bg-color,#f2f2f7)] min-h-dvh flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color,#007aff)] border-t-transparent" />
      </div>
    )
  }

  if (!task) {
    return (
      <div className="bg-[var(--tg-theme-bg-color,#f2f2f7)] min-h-dvh flex items-center justify-center">
        <p className="text-[var(--tg-theme-hint-color,#8e8e93)]">Задача не найдена</p>
      </div>
    )
  }

  const priority = priorityConfig[task.priority] ?? priorityConfig.MEDIUM
  const isOverdue =
    task.deadlineAt && new Date(task.deadlineAt) < new Date() && task.status !== 'DONE'
  const completedSubtasks = task.subtasks.filter((s) => s.isCompleted).length
  const totalSubtasks = task.subtasks.length
  const progress = totalSubtasks > 0 ? (completedSubtasks / totalSubtasks) * 100 : 0

  return (
    <div className="bg-[var(--tg-theme-bg-color,#f2f2f7)] min-h-dvh">
      {/* Заголовок */}
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color,#efeff4)] flex items-center justify-center active:scale-90 transition-transform"
          aria-label="Назад"
        >
          <ArrowLeft className="h-5 w-5 text-[var(--tg-theme-text-color,#000)]" />
        </button>
        <h1 className="text-lg font-semibold text-[var(--tg-theme-text-color,#000)] truncate flex-1">
          Детали задачи
        </h1>
      </header>

      <div className="px-4 pb-24 flex flex-col gap-3">
        {/* Карточка заголовка */}
        <div className="bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <h2 className="text-xl font-bold text-[var(--tg-theme-text-color,#000)] text-balance">
            {task.title}
          </h2>
          {task.description && (
            <p className="text-sm text-[var(--tg-theme-hint-color,#8e8e93)] mt-2 leading-relaxed">
              {task.description}
            </p>
          )}
        </div>

        {/* Мета-информация */}
        <div className="bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">Приоритет</span>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${priority.className}`}>
                {priority.label}
              </span>
            </div>

            {task.deadlineAt && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">Дедлайн</span>
                <span
                  className={`flex items-center gap-1.5 text-sm font-medium ${
                    isOverdue ? 'text-red-500' : 'text-[var(--tg-theme-text-color,#000)]'
                  }`}
                >
                  <Calendar className="h-4 w-4" />
                  {formatDate(task.deadlineAt)}
                  {isOverdue && (
                    <span className="text-[10px] bg-red-500/15 text-red-500 px-1.5 py-0.5 rounded-md font-semibold">
                      Просрочено
                    </span>
                  )}
                </span>
              </div>
            )}

            {task.projectName && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">Проект</span>
                <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--tg-theme-text-color,#000)]">
                  <FolderOpen className="h-4 w-4" />
                  {task.projectName}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Подзадачи */}
        <div className="bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-[var(--tg-theme-text-color,#000)]">
              Подзадачи
            </h3>
            {totalSubtasks > 0 && (
              <span className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)]">
                {completedSubtasks} из {totalSubtasks}
              </span>
            )}
          </div>

          {/* Прогресс-бар */}
          {totalSubtasks > 0 && (
            <div className="h-1.5 bg-[var(--tg-theme-secondary-bg-color,#efeff4)] rounded-full mb-3 overflow-hidden">
              <div
                className="h-full bg-[var(--tg-theme-button-color,#007aff)] rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {/* Список подзадач */}
          <div className="flex flex-col gap-1.5">
            {task.subtasks.map((subtask) => (
              <div key={subtask.id} className="flex items-center gap-3 py-2 px-1 group">
                <button
                  type="button"
                  onClick={() => handleSubtaskToggle(subtask.id, !subtask.isCompleted)}
                  className={`flex-shrink-0 h-5 w-5 rounded border-2 transition-all flex items-center justify-center ${
                    subtask.isCompleted
                      ? 'bg-[var(--tg-theme-button-color,#007aff)] border-[var(--tg-theme-button-color,#007aff)]'
                      : 'border-[var(--tg-theme-hint-color,#8e8e93)]/50'
                  }`}
                >
                  {subtask.isCompleted && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </button>
                <span
                  className={`flex-1 text-sm ${
                    subtask.isCompleted
                      ? 'line-through text-[var(--tg-theme-hint-color,#8e8e93)]'
                      : 'text-[var(--tg-theme-text-color,#000)]'
                  }`}
                >
                  {subtask.title}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteSubtask(subtask.id)}
                  className="opacity-0 group-hover:opacity-100 active:opacity-100 transition-opacity h-7 w-7 rounded-lg flex items-center justify-center text-red-400 active:bg-red-500/10"
                  aria-label="Удалить подзадачу"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Добавить подзадачу */}
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddSubtask()}
              placeholder="Добавить подзадачу..."
              className="flex-1 px-3 py-2 rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-sm text-[var(--tg-theme-text-color,#000)] placeholder:text-[var(--tg-theme-hint-color,#8e8e93)] outline-none"
            />
            <button
              type="button"
              onClick={handleAddSubtask}
              disabled={!newSubtask.trim()}
              className="h-9 w-9 rounded-lg bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)] flex items-center justify-center disabled:opacity-40 active:scale-90 transition-all"
              aria-label="Добавить"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Кнопки действий */}
        <div className="flex flex-col gap-2 mt-1">
          <button
            type="button"
            onClick={handleComplete}
            className="w-full py-3 rounded-xl bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)] font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            <Check className="h-5 w-5" />
            {task.status === 'DONE' ? 'Вернуть в работу' : 'Выполнено'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="w-full py-3 rounded-xl bg-red-500/10 text-red-500 font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            <Trash2 className="h-5 w-5" />
            Удалить
          </button>
        </div>
      </div>
    </div>
  )
}
