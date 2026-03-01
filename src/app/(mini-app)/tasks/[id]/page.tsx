'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { apiFetch } from '@/lib/telegram/webapp'
import { Calendar, Trash2, Plus } from 'lucide-react'

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

export default function TaskDetailPage() {
  const params = useParams()
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

  const handleStatusToggle = async () => {
    if (!task) return
    const newStatus = task.status === 'DONE' ? 'TODO' : 'DONE'
    setTask({ ...task, status: newStatus })
    await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    })
  }

  const handleDelete = async () => {
    await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
    window.history.back()
  }

  const handleSubtaskToggle = async (subtaskId: string, isCompleted: boolean) => {
    if (!task) return
    setTask({
      ...task,
      subtasks: task.subtasks.map((s) => (s.id === subtaskId ? { ...s, isCompleted } : s)),
    })
    await apiFetch(`/api/subtasks/${subtaskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ isCompleted }),
    })
  }

  const handleAddSubtask = async () => {
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
  }

  const handleDeleteSubtask = async (subtaskId: string) => {
    if (!task) return
    setTask({ ...task, subtasks: task.subtasks.filter((s) => s.id !== subtaskId) })
    await apiFetch(`/api/subtasks/${subtaskId}`, { method: 'DELETE' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color,#3b82f6)] border-t-transparent" />
      </div>
    )
  }

  if (!task) {
    return (
      <>
        <Header title="Задача" showBack />
        <div className="px-4 py-12 text-center text-[var(--tg-theme-hint-color,#9ca3af)]">
          Задача не найдена
        </div>
      </>
    )
  }

  const isDone = task.status === 'DONE'
  const completedSubtasks = task.subtasks.filter((s) => s.isCompleted).length
  const totalSubtasks = task.subtasks.length
  const subtaskProgress = totalSubtasks > 0 ? Math.round((completedSubtasks / totalSubtasks) * 100) : 0
  const priorityVariant = task.priority === 'HIGH' ? 'high' : task.priority === 'LOW' ? 'low' : 'medium'

  return (
    <>
      <Header title="Задача" showBack />
      <div className="px-4 py-2 space-y-4">
        {/* Заголовок */}
        <div className="rounded-xl bg-[var(--tg-theme-section-bg-color,#fff)] dark:bg-[var(--tg-theme-section-bg-color,#1c1c1e)] p-4">
          <h2 className="text-lg font-semibold">{task.title}</h2>
          {task.description && (
            <p className="mt-2 text-sm text-[var(--tg-theme-hint-color,#9ca3af)]">
              {task.description}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant={priorityVariant}>
              {task.priority === 'HIGH' ? 'Высокий' : task.priority === 'LOW' ? 'Низкий' : 'Средний'}
            </Badge>
            {task.deadlineAt && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(task.deadlineAt).toLocaleDateString('ru-RU')}
              </Badge>
            )}
            {task.projectName && <Badge variant="outline">📁 {task.projectName}</Badge>}
          </div>
        </div>

        {/* Подзадачи */}
        <div className="rounded-xl bg-[var(--tg-theme-section-bg-color,#fff)] dark:bg-[var(--tg-theme-section-bg-color,#1c1c1e)] p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">
              Подзадачи {totalSubtasks > 0 && `(${completedSubtasks}/${totalSubtasks})`}
            </h3>
          </div>
          {totalSubtasks > 0 && <Progress value={subtaskProgress} className="mb-3" />}
          <div className="space-y-2">
            {task.subtasks.map((subtask) => (
              <div key={subtask.id} className="flex items-center gap-3">
                <Checkbox
                  checked={subtask.isCompleted}
                  onChange={(checked) => handleSubtaskToggle(subtask.id, checked)}
                />
                <span className={`flex-1 text-sm ${subtask.isCompleted ? 'line-through opacity-50' : ''}`}>
                  {subtask.title}
                </span>
                <button
                  onClick={() => handleDeleteSubtask(subtask.id)}
                  className="text-[var(--tg-theme-hint-color,#9ca3af)] active:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          {/* Добавить подзадачу */}
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddSubtask()}
              placeholder="Новая подзадача..."
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-1.5 text-sm outline-none"
            />
            <Button variant="ghost" size="icon" onClick={handleAddSubtask}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Действия */}
        <div className="flex gap-2">
          <Button className="flex-1" onClick={handleStatusToggle}>
            {isDone ? '↩️ Вернуть' : '✅ Выполнено'}
          </Button>
          <Button variant="destructive" size="icon" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  )
}
