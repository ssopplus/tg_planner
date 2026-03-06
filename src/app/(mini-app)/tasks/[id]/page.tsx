'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Calendar,
  Trash2,
  Check,
  Plus,
  X,
  FolderOpen,
  ChevronDown,
  Pencil,
} from 'lucide-react'
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

interface ProjectOption {
  id: string
  name: string
  isDefault: boolean
}

const priorityConfig: Record<string, { label: string; className: string }> = {
  HIGH: { label: 'Высокий', className: 'bg-red-500/15 text-red-600' },
  MEDIUM: { label: 'Средний', className: 'bg-orange-500/15 text-orange-600' },
  LOW: { label: 'Низкий', className: 'bg-green-500/15 text-green-600' },
}

const statusConfig: Record<string, { label: string; className: string }> = {
  TODO: { label: 'Сделать', className: 'bg-blue-500/15 text-blue-600' },
  IN_PROGRESS: { label: 'В работе', className: 'bg-orange-500/15 text-orange-600' },
  DONE: { label: 'Готово', className: 'bg-green-500/15 text-green-600' },
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function toLocalDateString(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function TaskDetailPage() {
  const params = useParams()
  const router = useRouter()
  const taskId = params.id as string
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [newSubtask, setNewSubtask] = useState('')

  // Состояния редактирования
  const [editingTitle, setEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [editDesc, setEditDesc] = useState('')
  const [showPriorityPicker, setShowPriorityPicker] = useState(false)
  const [showStatusPicker, setShowStatusPicker] = useState(false)
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false)
  const [deadlineInput, setDeadlineInput] = useState('')
  const [deadlineTypeInput, setDeadlineTypeInput] = useState<string>('HARD')
  const [projects, setProjects] = useState<ProjectOption[]>([])

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

  const patchTask = useCallback(
    async (data: Record<string, unknown>) => {
      await apiFetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      })
    },
    [taskId],
  )

  const fetchProjects = useCallback(async () => {
    const res = await apiFetch('/api/projects')
    if (res.ok) setProjects(await res.json())
  }, [])

  const saveTitle = useCallback(() => {
    if (!editTitle.trim() || !task || editTitle.trim() === task.title) {
      setEditingTitle(false)
      return
    }
    setTask({ ...task, title: editTitle.trim() })
    setEditingTitle(false)
    patchTask({ title: editTitle.trim() })
  }, [editTitle, task, patchTask])

  const saveDesc = useCallback(() => {
    if (!task) return
    const newDesc = editDesc.trim() || null
    if (newDesc === task.description) {
      setEditingDesc(false)
      return
    }
    setTask({ ...task, description: newDesc })
    setEditingDesc(false)
    patchTask({ description: newDesc })
  }, [editDesc, task, patchTask])

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
  const taskStatus = statusConfig[task.status] ?? statusConfig.TODO
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
        {/* Название + Описание */}
        <div className="bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          {editingTitle ? (
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle()
                if (e.key === 'Escape') setEditingTitle(false)
              }}
              onBlur={saveTitle}
              autoFocus
              className="w-full text-xl font-bold bg-transparent text-[var(--tg-theme-text-color,#000)] outline-none border-b-2 border-[var(--tg-theme-button-color,#007aff)] text-base"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditTitle(task.title)
                setEditingTitle(true)
              }}
              className="w-full text-left group"
            >
              <div className="flex items-start gap-2">
                <h2 className="text-xl font-bold text-[var(--tg-theme-text-color,#000)] text-balance flex-1">
                  {task.title}
                </h2>
                <Pencil className="h-4 w-4 text-[var(--tg-theme-hint-color,#8e8e93)] opacity-0 group-active:opacity-100 flex-shrink-0 mt-1" />
              </div>
            </button>
          )}

          {editingDesc ? (
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              onBlur={saveDesc}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditingDesc(false)
              }}
              autoFocus
              placeholder="Добавьте описание..."
              rows={3}
              className="w-full mt-3 text-sm bg-transparent text-[var(--tg-theme-text-color,#000)] outline-none border-b-2 border-[var(--tg-theme-button-color,#007aff)] placeholder:text-[var(--tg-theme-hint-color,#8e8e93)] resize-none text-base"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditDesc(task.description ?? '')
                setEditingDesc(true)
              }}
              className="w-full text-left mt-2"
            >
              <p className="text-sm leading-relaxed text-[var(--tg-theme-hint-color,#8e8e93)]">
                {task.description || 'Добавить описание...'}
              </p>
            </button>
          )}
        </div>

        {/* Мета-информация */}
        <div className="bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <div className="flex flex-col gap-3">
            {/* Статус */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowStatusPicker(!showStatusPicker)
                  setShowPriorityPicker(false)
                  setShowDeadlinePicker(false)
                  setShowProjectPicker(false)
                }}
                className="flex items-center justify-between w-full"
              >
                <span className="text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">Статус</span>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 ${taskStatus.className}`}>
                  {taskStatus.label}
                  <ChevronDown className="h-3 w-3" />
                </span>
              </button>
              {showStatusPicker && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl shadow-lg border border-[var(--tg-theme-hint-color,#8e8e93)]/10 overflow-hidden z-10">
                  {Object.entries(statusConfig).map(([key, cfg]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setTask({ ...task, status: key })
                        setShowStatusPicker(false)
                        patchTask({ status: key })
                      }}
                      className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 ${
                        task.status === key
                          ? 'bg-[var(--tg-theme-button-color,#007aff)]/10 text-[var(--tg-theme-button-color,#007aff)]'
                          : 'text-[var(--tg-theme-text-color,#000)]'
                      }`}
                    >
                      <span className={`inline-block h-2 w-2 rounded-full ${cfg.className.split(' ')[0]}`} />
                      {cfg.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Приоритет */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowPriorityPicker(!showPriorityPicker)
                  setShowStatusPicker(false)
                  setShowDeadlinePicker(false)
                  setShowProjectPicker(false)
                }}
                className="flex items-center justify-between w-full"
              >
                <span className="text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">Приоритет</span>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 ${priority.className}`}>
                  {priority.label}
                  <ChevronDown className="h-3 w-3" />
                </span>
              </button>
              {showPriorityPicker && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl shadow-lg border border-[var(--tg-theme-hint-color,#8e8e93)]/10 overflow-hidden z-10">
                  {Object.entries(priorityConfig).map(([key, cfg]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setTask({ ...task, priority: key })
                        setShowPriorityPicker(false)
                        patchTask({ priority: key })
                      }}
                      className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 ${
                        task.priority === key
                          ? 'bg-[var(--tg-theme-button-color,#007aff)]/10 text-[var(--tg-theme-button-color,#007aff)]'
                          : 'text-[var(--tg-theme-text-color,#000)]'
                      }`}
                    >
                      <span className={`inline-block h-2 w-2 rounded-full ${cfg.className.split(' ')[0]}`} />
                      {cfg.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Дедлайн */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setDeadlineInput(task.deadlineAt ? toLocalDateString(task.deadlineAt) : '')
                  setDeadlineTypeInput(task.deadlineType ?? 'HARD')
                  setShowDeadlinePicker(!showDeadlinePicker)
                  setShowStatusPicker(false)
                  setShowPriorityPicker(false)
                  setShowProjectPicker(false)
                }}
                className="flex items-center justify-between w-full"
              >
                <span className="text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">Срок</span>
                {task.deadlineAt ? (
                  <span
                    className={`flex items-center gap-1.5 text-sm font-medium ${
                      isOverdue ? 'text-red-500' : 'text-[var(--tg-theme-text-color,#000)]'
                    }`}
                  >
                    <Calendar className="h-4 w-4" />
                    {formatDate(task.deadlineAt)}
                    {task.deadlineType && (
                      <span className="text-[10px] bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-1.5 py-0.5 rounded-md">
                        {task.deadlineType === 'HARD' ? 'Жёсткий' : 'Мягкий'}
                      </span>
                    )}
                    {isOverdue && (
                      <span className="text-[10px] bg-red-500/15 text-red-500 px-1.5 py-0.5 rounded-md font-semibold">
                        !
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">
                    <Calendar className="h-4 w-4" />
                    Не задан
                  </span>
                )}
              </button>
              {showDeadlinePicker && (
                <div className="absolute right-0 top-full mt-1 w-64 bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl shadow-lg border border-[var(--tg-theme-hint-color,#8e8e93)]/10 p-3 z-10">
                  <input
                    type="date"
                    value={deadlineInput}
                    onChange={(e) => setDeadlineInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-sm text-[var(--tg-theme-text-color,#000)] outline-none text-base"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setDeadlineTypeInput('HARD')}
                      className={`flex-1 text-xs py-1.5 rounded-lg font-medium ${
                        deadlineTypeInput === 'HARD'
                          ? 'bg-red-500/15 text-red-600'
                          : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-hint-color,#8e8e93)]'
                      }`}
                    >
                      Жёсткий
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeadlineTypeInput('SOFT')}
                      className={`flex-1 text-xs py-1.5 rounded-lg font-medium ${
                        deadlineTypeInput === 'SOFT'
                          ? 'bg-orange-500/15 text-orange-600'
                          : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-hint-color,#8e8e93)]'
                      }`}
                    >
                      Мягкий
                    </button>
                  </div>
                  <div className="flex gap-2 mt-3">
                    {task.deadlineAt && (
                      <button
                        type="button"
                        onClick={() => {
                          setTask({ ...task, deadlineAt: null, deadlineType: null })
                          setShowDeadlinePicker(false)
                          patchTask({ deadlineAt: null, deadlineType: null })
                        }}
                        className="flex-1 text-xs py-2 rounded-lg text-red-500 bg-red-500/10 font-medium"
                      >
                        Убрать
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (!deadlineInput) return
                        const newDeadline = new Date(deadlineInput + 'T23:59:59').toISOString()
                        setTask({ ...task, deadlineAt: newDeadline, deadlineType: deadlineTypeInput })
                        setShowDeadlinePicker(false)
                        patchTask({ deadlineAt: newDeadline, deadlineType: deadlineTypeInput })
                      }}
                      disabled={!deadlineInput}
                      className="flex-1 text-xs py-2 rounded-lg bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)] font-medium disabled:opacity-40"
                    >
                      Сохранить
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Проект */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowProjectPicker(!showProjectPicker)
                  setShowStatusPicker(false)
                  setShowPriorityPicker(false)
                  setShowDeadlinePicker(false)
                  if (!showProjectPicker) fetchProjects()
                }}
                className="flex items-center justify-between w-full"
              >
                <span className="text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">Проект</span>
                <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--tg-theme-text-color,#000)]">
                  <FolderOpen className="h-4 w-4" />
                  {task.projectName ?? 'Не выбран'}
                  <ChevronDown className="h-3 w-3 text-[var(--tg-theme-hint-color,#8e8e93)]" />
                </span>
              </button>
              {showProjectPicker && projects.length > 0 && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl shadow-lg border border-[var(--tg-theme-hint-color,#8e8e93)]/10 overflow-hidden z-10">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setTask({ ...task, projectId: p.id, projectName: p.name })
                        setShowProjectPicker(false)
                        patchTask({ projectId: p.id })
                      }}
                      className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 ${
                        task.projectId === p.id
                          ? 'bg-[var(--tg-theme-button-color,#007aff)]/10 text-[var(--tg-theme-button-color,#007aff)]'
                          : 'text-[var(--tg-theme-text-color,#000)]'
                      }`}
                    >
                      <FolderOpen className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
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

          {totalSubtasks > 0 && (
            <div className="h-1.5 bg-[var(--tg-theme-secondary-bg-color,#efeff4)] rounded-full mb-3 overflow-hidden">
              <div
                className="h-full bg-[var(--tg-theme-button-color,#007aff)] rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

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

          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddSubtask()}
              placeholder="Добавить подзадачу..."
              className="flex-1 px-3 py-2 rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-sm text-[var(--tg-theme-text-color,#000)] placeholder:text-[var(--tg-theme-hint-color,#8e8e93)] outline-none text-base"
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

        {/* Удалить */}
        <div className="mt-1">
          <button
            type="button"
            onClick={handleDelete}
            className="w-full py-3 rounded-xl bg-red-500/10 text-red-500 font-semibold text-base flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            <Trash2 className="h-5 w-5" />
            Удалить задачу
          </button>
        </div>
      </div>
    </div>
  )
}
