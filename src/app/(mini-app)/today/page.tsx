'use client'

import { useEffect, useState, useCallback } from 'react'
import { SwipeableTaskCard } from '@/components/tasks/swipeable-task-card'
import { type TaskCardData } from '@/components/tasks/task-card'
import { PullToRefresh } from '@/components/ui/pull-to-refresh'
import { EmptyState } from '@/components/ui/empty-state'
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

  const handleComplete = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'DONE' }),
    })
  }, [])

  const handleRemoveFromDay = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ myDayDate: null }),
    })
  }, [])

  const today = new Date()
  const dateStr = today.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <div className="bg-[var(--tg-theme-bg-color,#f2f2f7)] min-h-dvh">
      <PullToRefresh onRefresh={handleRefresh}>
        <header className="px-4 pt-4 pb-2">
          <h1 className="text-2xl font-bold text-[var(--tg-theme-text-color,#000)]">
            {'☀️ Мой день'}
          </h1>
          <p className="text-sm text-[var(--tg-theme-hint-color,#8e8e93)] mt-0.5 capitalize">
            {dateStr}
          </p>
        </header>

        <div className="px-4 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color,#007aff)] border-t-transparent" />
            </div>
          ) : tasks.length === 0 ? (
            <EmptyState
              icon="🎉"
              title="Все задачи выполнены!"
              description="Добавьте задачи в «Мой день» из списка задач"
            />
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

          {!loading && tasks.length > 0 && (
            <p className="text-center text-xs text-[var(--tg-theme-hint-color,#8e8e93)] mt-4 px-4">
              Свайп влево — выполнить · Свайп вправо — убрать из дня
            </p>
          )}
        </div>
      </PullToRefresh>
    </div>
  )
}
