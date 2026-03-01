'use client'

import { useEffect, useState, useCallback } from 'react'
import { Header } from '@/components/layout/header'
import { ProjectCard, type ProjectCardData } from '@/components/projects/project-card'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/telegram/webapp'
import { Plus } from 'lucide-react'

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectCardData[]>([])
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

  const handleCreate = async () => {
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
  }

  return (
    <>
      <Header title="📁 Проекты" />
      <div className="px-4 py-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tg-theme-button-color,#3b82f6)] border-t-transparent" />
          </div>
        ) : projects.length === 0 ? (
          <div className="py-12 text-center text-[var(--tg-theme-hint-color,#9ca3af)]">
            Проектов нет
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}

        {showForm && (
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Название проекта..."
              autoFocus
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-3 py-2 text-sm outline-none"
            />
            <Button onClick={handleCreate} size="sm">
              Создать
            </Button>
          </div>
        )}

        <Button variant="outline" className="mt-4 w-full" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4 mr-2" />
          Новый проект
        </Button>
      </div>
    </>
  )
}
