'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { FolderOpen, ChevronRight, Plus } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { apiFetch } from '@/lib/telegram/webapp'

interface ProjectData {
  id: string
  name: string
  taskCount: number
}

function pluralTasks(n: number): string {
  if (n === 1) return 'задача'
  if (n >= 2 && n <= 4) return 'задачи'
  return 'задач'
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectData[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')

  const fetchProjects = useCallback(async () => {
    try {
      const res = await apiFetch('/api/projects')
      if (res.ok) setProjects(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const handleAdd = useCallback(async () => {
    if (!newName.trim()) return
    const res = await apiFetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: newName.trim() }),
    })
    if (res.ok) {
      setNewName('')
      setShowForm(false)
      fetchProjects()
    }
  }, [newName, fetchProjects])

  return (
    <div className="bg-[var(--tg-theme-bg-color,#f2f2f7)] min-h-dvh">
      <header className="px-4 pt-4 pb-2">
        <h1 className="text-2xl font-bold text-[var(--tg-theme-text-color,#000)]">
          {'📁 Проекты'}
        </h1>
      </header>

      <div className="px-4 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color,#007aff)] border-t-transparent" />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon="📂"
            title="Нет проектов"
            description="Создайте первый проект для организации задач"
          />
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl px-4 py-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.06)] flex items-center gap-3 active:scale-[0.98] transition-transform"
              >
                <div className="h-10 w-10 rounded-xl bg-[var(--tg-theme-button-color,#007aff)]/10 flex items-center justify-center flex-shrink-0">
                  <FolderOpen className="h-5 w-5 text-[var(--tg-theme-button-color,#007aff)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[15px] font-semibold text-[var(--tg-theme-text-color,#000)] truncate">
                    {project.name}
                  </h3>
                  <p className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)] mt-0.5">
                    {project.taskCount} {pluralTasks(project.taskCount)}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-[var(--tg-theme-hint-color,#8e8e93)] flex-shrink-0" />
              </Link>
            ))}
          </div>
        )}

        {/* Форма создания проекта */}
        {showForm ? (
          <div className="mt-4 bg-[var(--tg-theme-section-bg-color,#fff)] rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
            <h3 className="text-sm font-semibold text-[var(--tg-theme-text-color,#000)] mb-2">
              Новый проект
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder="Название проекта..."
                autoFocus
                className="flex-1 px-3 py-2.5 rounded-xl bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-sm text-[var(--tg-theme-text-color,#000)] placeholder:text-[var(--tg-theme-hint-color,#8e8e93)] outline-none"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={!newName.trim()}
                className="px-4 py-2.5 rounded-xl bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)] text-sm font-medium disabled:opacity-40 active:scale-95 transition-all"
              >
                Создать
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowForm(false)
                setNewName('')
              }}
              className="text-xs text-[var(--tg-theme-hint-color,#8e8e93)] mt-2 active:opacity-70"
            >
              Отмена
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="mt-4 w-full py-3 rounded-xl border-2 border-dashed border-[var(--tg-theme-hint-color,#8e8e93)]/30 text-[var(--tg-theme-hint-color,#8e8e93)] text-sm font-medium flex items-center justify-center gap-2 active:bg-[var(--tg-theme-secondary-bg-color,#efeff4)] transition-colors"
          >
            <Plus className="h-4 w-4" />
            Создать проект
          </button>
        )}
      </div>
    </div>
  )
}
