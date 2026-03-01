'use client'

import { useEffect, useState, useCallback } from 'react'
import { Header } from '@/components/layout/header'
import { SwipeableTaskCard } from '@/components/tasks/swipeable-task-card'
import { type TaskCardData } from '@/components/tasks/task-card'
import { PullToRefresh } from '@/components/ui/pull-to-refresh'
import { apiFetch } from '@/lib/telegram/webapp'

export default function TodayPage() {
  const [tasks, setTasks] = useState<TaskCardData[]>([])
  const [loading, setLoading] = useState(true)

  const fetchTasks = useCallback(async () => {
    try {
      const res = await apiFetch('/api/today')
      if (res.ok) setTasks(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const handleRefresh = useCallback(async () => {
    const res = await apiFetch('/api/today')
    if (res.ok) setTasks(await res.json())
  }, [])

  const handleReorder = async (ids: string[]) => {
    const reordered = ids.map((id) => tasks.find((t) => t.id === id)!).filter(Boolean)
    setTasks(reordered)
    await apiFetch('/api/today', {
      method: 'PATCH',
      body: JSON.stringify({ ids }),
    })
  }

  const handleToggle = async (id: string, done: boolean) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: done ? 'DONE' : 'TODO' } : t)))
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: done ? 'DONE' : 'TODO' }),
    })
  }

  const handleComplete = async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'DONE' }),
    })
  }

  const handleRemoveFromDay = async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ myDayDate: null }),
    })
  }

  return (
    <>
      <Header title="☀️ Мой день" />
      <PullToRefresh onRefresh={handleRefresh}>
        <div className="px-4 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color,#3b82f6)] border-t-transparent" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--tg-theme-hint-color,#9ca3af)]">
              <p className="text-sm">Задач на сегодня нет</p>
              <p className="mt-1 text-xs">Потяните вниз для обновления</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {tasks.map((task) => (
                <SwipeableTaskCard
                  key={task.id}
                  task={task}
                  onComplete={handleComplete}
                  onRemove={handleRemoveFromDay}
                />
              ))}
            </div>
          )}
        </div>
      </PullToRefresh>
    </>
  )
}
