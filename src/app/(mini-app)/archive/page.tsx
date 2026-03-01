'use client'

import { useEffect, useState, useCallback } from 'react'
import { Header } from '@/components/layout/header'
import { TaskList } from '@/components/tasks/task-list'
import { type TaskCardData } from '@/components/tasks/task-card'
import { apiFetch } from '@/lib/telegram/webapp'
import { Search } from 'lucide-react'

export default function ArchivePage() {
  const [tasks, setTasks] = useState<TaskCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  const fetchTasks = useCallback(async (pageNum: number, append: boolean = false) => {
    try {
      const res = await apiFetch(`/api/tasks?status=DONE,ARCHIVED&page=${pageNum}&limit=20&sort=created`)
      if (res.ok) {
        const data = await res.json()
        if (append) {
          setTasks((prev) => [...prev, ...data])
        } else {
          setTasks(data)
        }
        setHasMore(data.length === 20)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTasks(1)
  }, [fetchTasks])

  const handleRestore = async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'TODO' }),
    })
  }

  const filteredTasks = search
    ? tasks.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
    : tasks

  return (
    <>
      <Header title="📦 Архив" showBack />
      <div className="px-4 py-2">
        {/* Поиск */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--tg-theme-hint-color,#9ca3af)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск..."
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent pl-9 pr-3 py-2 text-sm outline-none"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color,#3b82f6)] border-t-transparent" />
          </div>
        ) : (
          <>
            <TaskList
              tasks={filteredTasks}
              onToggle={(id) => handleRestore(id)}
              emptyMessage="Архив пуст"
            />
            {hasMore && !search && (
              <button
                onClick={() => {
                  const nextPage = page + 1
                  setPage(nextPage)
                  fetchTasks(nextPage, true)
                }}
                className="mt-4 w-full py-2 text-center text-sm text-[var(--tg-theme-link-color,#3b82f6)]"
              >
                Загрузить ещё
              </button>
            )}
          </>
        )}
      </div>
    </>
  )
}
