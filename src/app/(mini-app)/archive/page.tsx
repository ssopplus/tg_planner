'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Search, RotateCcw } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { apiFetch } from '@/lib/telegram/webapp'

interface ArchivedTask {
  id: string
  title: string
  completedAt: string | null
}

const PAGE_SIZE = 20

export default function ArchivePage() {
  const router = useRouter()
  const [tasks, setTasks] = useState<ArchivedTask[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  const fetchTasks = useCallback(
    async (pageNum: number, append = false) => {
      try {
        const res = await apiFetch(
          `/api/tasks?status=DONE,ARCHIVED&page=${pageNum}&limit=${PAGE_SIZE}&sort=created`,
        )
        if (res.ok) {
          const data = await res.json()
          if (append) {
            setTasks((prev) => [...prev, ...data])
          } else {
            setTasks(data)
          }
          setHasMore(data.length === PAGE_SIZE)
        }
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    fetchTasks(1)
  }, [fetchTasks])

  const handleRestore = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'TODO' }),
    })
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return tasks
    const q = search.toLowerCase()
    return tasks.filter((t) => t.title.toLowerCase().includes(q))
  }, [tasks, search])

  return (
    <div className="bg-[var(--tg-theme-bg-color,#f2f2f7)] min-h-dvh">
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="h-9 w-9 rounded-full bg-[var(--tg-theme-secondary-bg-color,#efeff4)] flex items-center justify-center active:scale-90 transition-transform"
          aria-label="Назад"
        >
          <ArrowLeft className="h-5 w-5 text-[var(--tg-theme-text-color,#000)]" />
        </button>
        <h1 className="text-lg font-semibold text-[var(--tg-theme-text-color,#000)]">
          {'📦 Архив'}
        </h1>
      </header>

      {/* Поиск */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--tg-theme-hint-color,#8e8e93)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Поиск по завершённым задачам..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[var(--tg-theme-section-bg-color,#fff)] text-sm text-[var(--tg-theme-text-color,#000)] placeholder:text-[var(--tg-theme-hint-color,#8e8e93)] outline-none shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
          />
        </div>
      </div>

      {/* Список */}
      <div className="px-4 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color,#007aff)] border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="🔍"
            title={search ? 'Ничего не найдено' : 'Архив пуст'}
            description={search ? 'Попробуйте изменить запрос' : 'Завершённые задачи появятся здесь'}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((task) => (
              <div
                key={task.id}
                className="bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)] flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--tg-theme-hint-color,#8e8e93)] line-through truncate">
                    {task.title}
                  </p>
                  {task.completedAt && (
                    <p className="text-[11px] text-[var(--tg-theme-hint-color,#8e8e93)]/70 mt-0.5">
                      {new Date(task.completedAt).toLocaleDateString('ru-RU', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRestore(task.id)}
                  className="h-8 w-8 rounded-lg bg-[var(--tg-theme-button-color,#007aff)]/10 flex items-center justify-center active:scale-90 transition-transform flex-shrink-0"
                  aria-label="Восстановить задачу"
                >
                  <RotateCcw className="h-4 w-4 text-[var(--tg-theme-button-color,#007aff)]" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Загрузить ещё */}
        {hasMore && !search && !loading && (
          <button
            type="button"
            onClick={() => {
              const nextPage = page + 1
              setPage(nextPage)
              fetchTasks(nextPage, true)
            }}
            className="mt-4 w-full py-3 rounded-xl bg-[var(--tg-theme-section-bg-color,#fff)] text-[var(--tg-theme-button-color,#007aff)] text-sm font-medium shadow-[0_1px_3px_rgba(0,0,0,0.06)] active:scale-[0.98] transition-transform"
          >
            Загрузить ещё
          </button>
        )}
      </div>
    </div>
  )
}
