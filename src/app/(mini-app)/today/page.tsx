'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Search, Sun, Check } from 'lucide-react'
import { SwipeableTaskCard } from '@/components/tasks/swipeable-task-card'
import { type TaskCardData } from '@/components/tasks/task-card'
import { PullToRefresh } from '@/components/ui/pull-to-refresh'
import { EmptyState } from '@/components/ui/empty-state'
import { apiFetch } from '@/lib/telegram/webapp'

export default function TodayPage() {
  const [tasks, setTasks] = useState<TaskCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [showPicker, setShowPicker] = useState(false)
  const [allTasks, setAllTasks] = useState<TaskCardData[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [search, setSearch] = useState('')

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

  const todayStr = new Date().toISOString().split('T')[0]

  const openPicker = useCallback(async () => {
    setShowPicker(true)
    setPickerLoading(true)
    setSearch('')
    try {
      const res = await apiFetch('/api/tasks')
      if (res.ok) setAllTasks(await res.json())
    } finally {
      setPickerLoading(false)
    }
  }, [])

  const closePicker = useCallback(() => {
    setShowPicker(false)
    fetchTasks()
  }, [fetchTasks])

  const toggleMyDay = useCallback(async (taskId: string, currentlyInDay: boolean) => {
    const newMyDayDate = currentlyInDay ? null : todayStr
    setAllTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, myDayDate: newMyDayDate } : t)),
    )
    await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ myDayDate: newMyDayDate }),
    })
  }, [todayStr])

  const filteredTasks = allTasks.filter((t) =>
    !search || t.title.toLowerCase().includes(search.toLowerCase()),
  )

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

        <div className="px-4 pb-24">
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

          {/* Кнопка добавления */}
          {!loading && (
            <button
              type="button"
              onClick={openPicker}
              className="mt-4 w-full py-3 rounded-xl border-2 border-dashed border-[var(--tg-theme-hint-color,#8e8e93)]/30 text-[var(--tg-theme-hint-color,#8e8e93)] text-sm font-medium flex items-center justify-center gap-2 active:bg-[var(--tg-theme-secondary-bg-color,#efeff4)] transition-colors"
            >
              <Plus className="h-4 w-4" />
              Добавить задачу в день
            </button>
          )}
        </div>
      </PullToRefresh>

      {/* Bottom-sheet выбора задач */}
      {showPicker && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30" onClick={closePicker}>
          <div
            className="w-full max-w-md bg-[var(--tg-theme-section-bg-color,#fff)] rounded-t-2xl animate-in slide-in-from-bottom duration-300"
            style={{ maxHeight: '70vh', marginBottom: 'calc(3.5rem + max(env(safe-area-inset-bottom, 0px), 0.5rem))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-[var(--tg-theme-hint-color,#8e8e93)]/30 mx-auto mt-3 mb-2" />
            <div className="px-4 pb-2">
              <h3 className="text-lg font-semibold text-[var(--tg-theme-text-color,#000)]">
                Добавить в «Мой день»
              </h3>
            </div>

            {/* Поиск */}
            <div className="px-4 pb-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--tg-theme-hint-color,#8e8e93)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск задач..."
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-sm text-[var(--tg-theme-text-color,#000)] placeholder:text-[var(--tg-theme-hint-color,#8e8e93)] outline-none"
                />
              </div>
            </div>

            {/* Список задач */}
            <div className="overflow-y-auto px-4 pb-4" style={{ maxHeight: 'calc(70vh - 120px)' }}>
              {pickerLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color,#007aff)] border-t-transparent" />
                </div>
              ) : filteredTasks.length === 0 ? (
                <p className="text-center text-sm text-[var(--tg-theme-hint-color,#8e8e93)] py-8">
                  {search ? 'Ничего не найдено' : 'Нет активных задач'}
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {filteredTasks.map((task) => {
                    const manuallyAdded = task.myDayDate === todayStr
                    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59)
                    const autoIncluded = !manuallyAdded && (
                      (task.deadlineAt && new Date(task.deadlineAt) <= endOfDay) ||
                      (task.priority === 'HIGH' && !task.deadlineAt)
                    )
                    const inDay = manuallyAdded || autoIncluded
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => !autoIncluded && toggleMyDay(task.id, manuallyAdded)}
                        className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${
                          autoIncluded ? 'opacity-60' : 'active:bg-[var(--tg-theme-secondary-bg-color,#efeff4)]'
                        }`}
                      >
                        <div
                          className={`flex-shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all ${
                            inDay
                              ? 'bg-amber-500 border-amber-500'
                              : 'border-[var(--tg-theme-hint-color,#8e8e93)]'
                          }`}
                        >
                          {inDay ? (
                            <Check className="h-3 w-3 text-white" />
                          ) : (
                            <Sun className="h-3 w-3 text-[var(--tg-theme-hint-color,#8e8e93)]" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-[15px] text-[var(--tg-theme-text-color,#000)] truncate block">
                            {task.title}
                          </span>
                          <span className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)]">
                            {autoIncluded ? 'Добавлена автоматически' : task.projectName ?? ''}
                          </span>
                        </div>
                        {inDay && (
                          <Sun className="h-4 w-4 text-amber-500 fill-amber-500 flex-shrink-0" />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
