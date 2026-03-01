'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { TaskList } from '@/components/tasks/task-list'
import { type TaskCardData } from '@/components/tasks/task-card'
import { apiFetch } from '@/lib/telegram/webapp'

export default function ProjectTasksPage() {
  const params = useParams()
  const projectId = params.id as string
  const [tasks, setTasks] = useState<TaskCardData[]>([])
  const [loading, setLoading] = useState(true)

  const fetchTasks = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/tasks?project_id=${projectId}`)
      if (res.ok) setTasks(await res.json())
    } finally {
      setLoading(false)
    }
  }, [projectId])

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

  return (
    <>
      <Header title="📁 Проект" showBack />
      <div className="px-4 py-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color,#3b82f6)] border-t-transparent" />
          </div>
        ) : (
          <TaskList tasks={tasks} onToggle={handleToggle} showProject={false} emptyMessage="В этом проекте нет задач" />
        )}
      </div>
    </>
  )
}
