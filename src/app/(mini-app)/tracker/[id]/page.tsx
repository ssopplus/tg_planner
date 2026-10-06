'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { apiFetch } from '@/lib/telegram/webapp'
import { TrackerDescription } from '@/lib/tracker/render-description'
import { WorklogPanel } from '@/components/tracker/worklog-panel'
import { StatusSwitcher } from '@/components/tracker/status-switcher'
import { CommentsSection } from '@/components/tracker/comments-section'

interface TaskDetail {
  id: string
  title: string
  description: string | null
  status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'ARCHIVED'
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  externalId: string | null
  externalSource: string | null
  projectName?: string | null
}

const STATUS_LABELS: Record<TaskDetail['status'], string> = {
  TODO: 'Открыта',
  IN_PROGRESS: 'В работе',
  DONE: 'Закрыта',
  ARCHIVED: 'В архиве',
}

export default function TrackerTaskPage() {
  const params = useParams()
  const router = useRouter()
  const taskId = params.id as string

  const [task, setTask] = useState<TaskDetail | null>(null)
  const [spentLabel, setSpentLabel] = useState('нет списаний')
  const [loading, setLoading] = useState(true)

  const loadTask = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/tasks/${taskId}`)
      if (res.ok) setTask((await res.json()) as TaskDetail)
    } finally {
      setLoading(false)
    }
  }, [taskId])

  const loadSpent = useCallback(
    (issueKey: string) =>
      apiFetch('/api/worklog?fresh=0').then(async (res) => {
        if (!res.ok) return
        const data = (await res.json()) as { rows: Array<{ issueKey: string; minutes: number }> }
        const minutes = data.rows
          .filter((row) => row.issueKey === issueKey)
          .reduce((sum, row) => sum + row.minutes, 0)
        setSpentLabel(minutes ? `сегодня ${formatMinutes(minutes)}` : 'нет списаний')
      }),
    [],
  )

  useEffect(() => {
    loadTask()
  }, [loadTask])

  useEffect(() => {
    if (task?.externalId) loadSpent(task.externalId)
  }, [task?.externalId, loadSpent])

  if (loading) {
    return (
      <p className="px-4 py-10 text-center text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">
        Загружаю задачу…
      </p>
    )
  }

  if (!task) {
    return (
      <p className="px-4 py-10 text-center text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">
        Задача не найдена.
      </p>
    )
  }

  const issueKey = task.externalId ?? ''

  return (
    <div className="flex flex-col gap-3 px-4 pt-3">
      <button
        type="button"
        onClick={() => router.back()}
        className="flex w-fit items-center gap-1 text-[14px] text-[var(--tg-theme-link-color,#007aff)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Назад
      </button>

      <div>
        <span className="font-mono text-[12px] font-medium text-[var(--tg-theme-link-color,#007aff)]">
          {issueKey}
        </span>
        <h1 className="text-balance text-[19px] font-bold leading-snug text-[var(--tg-theme-text-color,#000)]">
          {task.title}
        </h1>
        {task.projectName ? (
          <p className="mt-0.5 text-[12px] text-[var(--tg-theme-hint-color,#8e8e93)]">
            {task.projectName}
          </p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <StatusSwitcher
            issueKey={issueKey}
            statusLabel={STATUS_LABELS[task.status]}
            onChanged={loadTask}
          />
        </div>
        <a
          href={`https://tracker.yandex.ru/${issueKey}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-border bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-3 text-[14px] font-medium text-[var(--tg-theme-text-color,#000)]"
        >
          Трекер
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <WorklogPanel
        issueKey={issueKey}
        issueTitle={task.title}
        spentLabel={spentLabel}
        onLogged={() => loadSpent(issueKey)}
      />

      {task.description ? (
        <section className="rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-3">
          <h2 className="mb-1.5 text-[13px] font-semibold text-[var(--tg-theme-text-color,#000)]">
            Описание
          </h2>
          <TrackerDescription text={task.description} taskKey={issueKey} />
        </section>
      ) : null}

      <CommentsSection issueKey={issueKey} />
    </div>
  )
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}м`
  if (!m) return `${h}ч`
  return `${h}ч ${m}м`
}
