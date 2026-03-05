'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, List, Columns3 } from 'lucide-react'
import { TaskCard, type TaskCardData } from '@/components/tasks/task-card'
import { KanbanBoard } from '@/components/tasks/kanban-board'
import { EmptyState } from '@/components/ui/empty-state'
import { apiFetch } from '@/lib/telegram/webapp'

type SortMode = 'deadline' | 'priority' | 'created'
type ViewMode = 'list' | 'kanban'

const sortButtons: { mode: SortMode; label: string }[] = [
  { mode: 'deadline', label: 'По сроку' },
  { mode: 'priority', label: 'Приоритет' },
  { mode: 'created', label: 'По дате' },
]

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [sortMode, setSortMode] = useState<SortMode>('deadline')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [showForm, setShowForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const fetchTasks = useCallback(async () => {
    try {
      const statusParam = viewMode === 'kanban' ? '&status=TODO,IN_PROGRESS,DONE' : ''
      const res = await apiFetch(`/api/tasks?sort=${sortMode}${statusParam}`)
      if (res.ok) setTasks(await res.json())
    } finally {
      setLoading(false)
    }
  }, [sortMode, viewMode])

  useEffect(() => {
    setLoading(true)
    fetchTasks()
  }, [fetchTasks])

  const handleToggle = useCallback(async (id: string, done: boolean) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: done ? 'DONE' : 'TODO' } : t)))
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: done ? 'DONE' : 'TODO' }),
    })
  }, [])

  const handleStatusChange = useCallback(async (id: string, status: string) => {
    // Оптимистичное обновление
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)))
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  }, [])

  const handleAdd = useCallback(async () => {
    if (!newTitle.trim()) return
    const res = await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: newTitle.trim() }),
    })
    if (res.ok) {
      setNewTitle('')
      setShowForm(false)
      fetchTasks()
    }
  }, [newTitle, fetchTasks])

  return (
    <div className="bg-[var(--tg-theme-bg-color,#f2f2f7)] min-h-dvh">
      <header className="px-4 pt-4 pb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--tg-theme-text-color,#000)]">{'📋 Задачи'}</h1>
        <div className="flex gap-1 bg-[var(--tg-theme-secondary-bg-color,#efeff4)] rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-md transition-all ${
              viewMode === 'list'
                ? 'bg-[var(--tg-theme-section-bg-color,#fff)] shadow-sm'
                : 'text-[var(--tg-theme-hint-color,#8e8e93)]'
            }`}
            aria-label="Список"
          >
            <List className="h-4.5 w-4.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('kanban')}
            className={`p-1.5 rounded-md transition-all ${
              viewMode === 'kanban'
                ? 'bg-[var(--tg-theme-section-bg-color,#fff)] shadow-sm'
                : 'text-[var(--tg-theme-hint-color,#8e8e93)]'
            }`}
            aria-label="Канбан"
          >
            <Columns3 className="h-4.5 w-4.5" />
          </button>
        </div>
      </header>

      {/* Кнопки сортировки — только в режиме списка */}
      {viewMode === 'list' && (
        <div className="px-4 pb-3">
          <div className="flex gap-2">
            {sortButtons.map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSortMode(mode)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full transition-all ${
                  sortMode === mode
                    ? 'bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)]'
                    : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-hint-color,#8e8e93)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Контент */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color,#007aff)] border-t-transparent" />
        </div>
      ) : viewMode === 'kanban' ? (
        <KanbanBoard
          tasks={tasks}
          onStatusChange={handleStatusChange}
          onToggle={handleToggle}
        />
      ) : (
        <div className="px-4 pb-24">
          {tasks.length === 0 ? (
            <EmptyState icon="📝" title="Нет активных задач" description="Создайте первую задачу, нажав кнопку +" />
          ) : (
            <div className="flex flex-col gap-2">
              {tasks.map((task) => (
                <TaskCard key={task.id} task={task} onToggle={handleToggle} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bottom sheet для создания задачи */}
      {showForm && (
        <div
          className="fixed inset-0 z-[60] bg-black/30"
          onClick={() => setShowForm(false)}
        >
          <div
            className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] left-3 right-3 z-[60] max-w-md mx-auto bg-[var(--tg-theme-section-bg-color,#fff)] rounded-2xl p-4 shadow-lg animate-in slide-in-from-bottom duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex gap-2">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Название задачи..."
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-text-color,#000)] text-sm placeholder:text-[var(--tg-theme-hint-color,#8e8e93)] outline-none focus:ring-2 focus:ring-[var(--tg-theme-button-color,#007aff)]/30"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={!newTitle.trim()}
                className="px-5 py-2.5 rounded-xl bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)] text-sm font-medium disabled:opacity-40 transition-opacity active:scale-95"
              >
                Добавить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FAB */}
      {!showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)] shadow-lg flex items-center justify-center active:scale-90 transition-transform"
          aria-label="Добавить задачу"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}
    </div>
  )
}
