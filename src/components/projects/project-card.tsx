'use client'

import Link from 'next/link'
import { FolderOpen, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ProjectCardData {
  id: string
  name: string
  type: string
  isDefault: boolean
  taskCount: number
}

interface ProjectCardProps {
  project: ProjectCardData
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="flex items-center gap-3 rounded-xl bg-[var(--tg-theme-section-bg-color,#fff)] dark:bg-[var(--tg-theme-section-bg-color,#1c1c1e)] p-4 active:opacity-80 transition-opacity"
    >
      <FolderOpen className="h-5 w-5 text-[var(--tg-theme-button-color,#3b82f6)]" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{project.name}</span>
          {project.isDefault && (
            <span className="text-xs text-[var(--tg-theme-hint-color,#9ca3af)]">(по умолчанию)</span>
          )}
        </div>
        <span className="text-xs text-[var(--tg-theme-hint-color,#9ca3af)]">
          {project.taskCount} {taskWord(project.taskCount)}
        </span>
      </div>
      <ChevronRight className="h-4 w-4 text-[var(--tg-theme-hint-color,#9ca3af)]" />
    </Link>
  )
}

function taskWord(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'задача'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'задачи'
  return 'задач'
}
