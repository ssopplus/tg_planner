'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { TaskCard, type TaskCardData } from '@/components/tasks/task-card'
import { EmptyState } from '@/components/ui/empty-state'
import { apiFetch } from '@/lib/telegram/webapp'

export default function ProjectTasksPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string
  const [tasks, setTasks] = useState<TaskCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [projectName, setProjectName] = useState('')

  const fetchTasks = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/tasks?project_id=${projectId}`)
      if (res.ok) {
        const data = await res.json()
        setTasks(data)
        if (data.length > 0 && data[0].projectName) {
          setProjectName(data[0].projectName)
        }
      }
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const handleToggle = useCallback(async (id: string, done: boolean) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: done ? 'DONE' : 'TODO' } : t)))
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: done ? 'DONE' : 'TODO' }),
    })
  }, [])

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
        <h1 className="text-lg font-semibold text-[var(--tg-theme-text-color,#000)] truncate flex-1">
          {projectName || 'Проект'}
        </h1>
      </header>

      <div className="px-4 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color,#007aff)] border-t-transparent" />
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon="📄"
            title="Нет задач"
            description="В этом проекте пока нет активных задач"
          />
        ) : (
          <div className="flex flex-col gap-2">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} onToggle={handleToggle} showProject={false} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
