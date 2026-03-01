'use client'

import { useEffect, useState, useCallback } from 'react'
import { Header } from '@/components/layout/header'
import { TaskList } from '@/components/tasks/task-list'
import { Button } from '@/components/ui/button'
import { type TaskCardData } from '@/components/tasks/task-card'
import { apiFetch } from '@/lib/telegram/webapp'
import { Plus, Filter } from 'lucide-react'

type SortOption = 'deadline' | 'priority' | 'created'

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortOption>('deadline')
  const [showForm, setShowForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const fetchTasks = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/tasks?sort=${sort}`)
      if (res.ok) setTasks(await res.json())
    } finally {
      setLoading(false)
    }
  }, [sort])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const handleToggle = async (id: string, done: boolean) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: done ? 'DONE' : 'TODO' } : t)))
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: done ? 'DONE' : 'TODO' }),
    })
  }

  const handleCreate = async () => {
    if (!newTitle.trim()) return
    const res = await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: newTitle.trim(), projectId: tasks[0]?.projectId }),
    })
    if (res.ok) {
      setNewTitle('')
      setShowForm(false)
      fetchTasks()
    }
  }

  return (
    <>
      <Header title="📋 Задачи" />
      <div className="px-4 py-2">
        {/* Сортировка */}
        <div className="mb-3 flex gap-2">
          {(['deadline', 'priority', 'created'] as SortOption[]).map((s) => (
            <Button
              key={s}
              variant={sort === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSort(s)}
            >
              {s === 'deadline' ? '📅 Срок' : s === 'priority' ? '🔥 Приоритет' : '🕐 Дата'}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color,#3b82f6)] border-t-transparent" />
          </div>
        ) : (
          <TaskList tasks={tasks} onToggle={handleToggle} emptyMessage="Задач нет. Создай первую!" />
        )}

        {/* Быстрое создание */}
        {showForm && (
          <div className="fixed inset-x-0 bottom-14 z-50 border-t bg-[var(--tg-theme-bg-color,#fff)] dark:bg-[var(--tg-theme-bg-color,#000)] p-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="Название задачи..."
                autoFocus
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-sm outline-none"
              />
              <Button onClick={handleCreate} size="sm">
                Создать
              </Button>
            </div>
          </div>
        )}

        {/* FAB */}
        <button
          onClick={() => setShowForm(!showForm)}
          className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--tg-theme-button-color,#3b82f6)] text-white shadow-lg active:opacity-80"
        >
          <Plus className="h-6 w-6" />
        </button>
      </div>
    </>
  )
}
