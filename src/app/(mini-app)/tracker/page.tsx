'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Clock3 } from 'lucide-react'
import { apiFetch } from '@/lib/telegram/webapp'
import { TabStrip } from '@/components/ui/tab-strip'
import { EmptyState } from '@/components/ui/empty-state'
import { PullToRefresh } from '@/components/ui/pull-to-refresh'
import { STATUS, type Session } from '@/components/cockpit/session-parts'

type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'ARCHIVED'

interface TrackerTask {
  id: string
  title: string
  status: TaskStatus
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  externalId: string | null
  /** Статус словами Трекера — вкладки сводят их к трём, а на карточке видно исходный. */
  trackerStatus: string | null
  projectName: string | null
  deadlineAt: string | null
}

/** Сессия Claude Code по задаче (из снимка dev-cockpit) и план задачи из её заметки. */
interface ClaudeOnTask {
  session: Session
  done: number
  total: number
}

/**
 * Вкладки — не произвольный фильтр, а состояния рабочего дня: что делаю
 * сейчас, что ушло в тестирование, что ждёт очереди, что уже закрыто.
 * Синк (mapTrackerStatus) сводит тестирование в IN_PROGRESS, поэтому его
 * отделяем здесь — по статусу словами Трекера.
 */
const TABS = [
  { id: 'IN_PROGRESS', label: 'В работе' },
  { id: 'TESTING', label: 'Тестирование' },
  { id: 'TODO', label: 'Открытые' },
  { id: 'DONE', label: 'Закрытые' },
] as const

type TabId = (typeof TABS)[number]['id']

/** «Можно тестировать», «Тестируется», «Testing», «Ready for test» — у каждой очереди свои слова. */
const TESTING_RE = /тест|test/i

const isTesting = (t: TrackerTask) => t.status === 'IN_PROGRESS' && TESTING_RE.test(t.trackerStatus ?? '')

function tabOf(t: TrackerTask): TabId | null {
  if (isTesting(t)) return 'TESTING'
  return t.status === 'ARCHIVED' ? null : t.status
}

/** Цвет статуса Трекера — по нашему статусу, в который он сведён синком. */
const TRACKER_STATUS: Record<TaskStatus, string> = {
  TODO: 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-hint-color,#8e8e93)]',
  IN_PROGRESS: 'bg-blue-500/15 text-blue-500',
  DONE: 'bg-green-500/15 text-green-600',
  ARCHIVED: 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-hint-color,#8e8e93)]',
}

export default function TrackerPage() {
  const [tasks, setTasks] = useState<TrackerTask[]>([])
  const [spent, setSpent] = useState<Record<string, number>>({})
  const [todayTotal, setTodayTotal] = useState<string>('')
  const [tab, setTab] = useState<string>('IN_PROGRESS')
  const [loading, setLoading] = useState(true)
  const [claude, setClaude] = useState<Record<string, ClaudeOnTask[]>>({})

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/tasks?source=tracker&status=TODO,IN_PROGRESS,DONE&limit=200')
      if (res.ok) setTasks((await res.json()) as TrackerTask[])
    } finally {
      setLoading(false)
    }
  }, [])

  // Суммы времени — за сегодня. Сначала зеркало из БД (fresh=0), чтобы список
  // открывался сразу, затем перечитываем день из Трекера: время могли списать
  // мимо приложения, и до открытия экрана «Время» зеркало об этом не знает.
  const loadSpent = useCallback(async () => {
    const apply = async (res: Response) => {
      if (!res.ok) return
      const data = (await res.json()) as {
        rows: Array<{ issueKey: string; minutes: number }>
        totalLabel: string
        total: number
      }
      const totals: Record<string, number> = {}
      for (const row of data.rows) {
        totals[row.issueKey] = (totals[row.issueKey] ?? 0) + row.minutes
      }
      setSpent(totals)
      setTodayTotal(data.total > 0 ? data.totalLabel : '')
    }
    await apiFetch('/api/worklog?fresh=0').then(apply)
    await apiFetch('/api/worklog').then(apply).catch(() => undefined)
  }, [])

  // Какие задачи сейчас ведут сессии Claude Code — по снимку dev-cockpit с рабочей машины.
  const loadClaude = useCallback(async () => {
    const res = await apiFetch('/api/cockpit').catch(() => null)
    if (!res?.ok) return
    const data = (await res.json()) as { sessions: Session[] }
    const byKey: Record<string, ClaudeOnTask[]> = {}
    for (const session of data.sessions) {
      const keys = new Set([session.taskKey, ...(session.tasks ?? []).map((t) => t.issue)].filter(Boolean) as string[])
      for (const key of keys) {
        const t = session.tasks?.find((x) => x.issue === key)
        ;(byKey[key] ??= []).push({
          session,
          done: t?.todo.filter((x) => x.done).length ?? 0,
          total: t?.todo.length ?? 0,
        })
      }
    }
    setClaude(byKey)
  }, [])

  useEffect(() => {
    load()
    loadSpent()
    loadClaude()
  }, [load, loadSpent, loadClaude])

  const visible = useMemo(() => tasks.filter((t) => tabOf(t) === tab), [tasks, tab])
  const counts = useMemo(() => {
    const byTab: Record<string, number> = {}
    for (const t of tasks) {
      const id = tabOf(t)
      if (id) byTab[id] = (byTab[id] ?? 0) + 1
    }
    return byTab
  }, [tasks])

  return (
    <PullToRefresh
      onRefresh={async () => {
        await Promise.all([load(), loadSpent(), loadClaude()])
      }}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <h1 className="text-xl font-bold text-[var(--tg-theme-text-color,#000)]">Трекер</h1>
        <Link
          href="/tracker/time"
          className="flex items-center gap-1.5 rounded-full bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-3 py-1.5 text-[13px] font-medium text-[var(--tg-theme-text-color,#000)]"
        >
          <Clock3 className="h-4 w-4" />
          {todayTotal || 'Время'}
        </Link>
      </div>

      <TabStrip
        items={TABS.map((t) => ({ id: t.id, label: t.label, count: counts[t.id] }))}
        activeId={tab}
        onSelect={setTab}
      />

      <div className="flex flex-col gap-2 px-4 pt-3">
        {loading ? (
          <p className="py-10 text-center text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">
            Загружаю задачи…
          </p>
        ) : visible.length === 0 ? (
          <EmptyState
            icon="🗂"
            title="Здесь пусто"
            description={
              tab === 'IN_PROGRESS'
                ? 'Ни одна задача не взята в работу. Переведите задачу из «Открытых».'
                : tab === 'TESTING'
                  ? 'В тестировании ничего нет.'
                  : 'Задачи приезжают из Яндекс.Трекера при синхронизации.'
            }
          />
        ) : (
          visible.map((task) => (
            <TrackerCard
              key={task.id}
              task={task}
              spentMinutes={spent[task.externalId ?? '']}
              claude={claude[task.externalId ?? '']}
            />
          ))
        )}
      </div>
    </PullToRefresh>
  )
}

function TrackerCard({
  task,
  spentMinutes,
  claude,
}: {
  task: TrackerTask
  spentMinutes?: number
  claude?: ClaudeOnTask[]
}) {
  const overdue = task.deadlineAt ? new Date(task.deadlineAt) < new Date() : false

  return (
    <Link
      href={`/tracker/${task.id}`}
      className="block rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-3 active:opacity-70"
      style={{
        borderLeftWidth: 3,
        borderLeftColor:
          task.priority === 'HIGH'
            ? 'var(--tg-theme-destructive-text-color,#d1453b)'
            : 'var(--tg-theme-button-color,#007aff)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[11px] font-medium text-[var(--tg-theme-link-color,#007aff)]">
            {task.externalId}
          </span>
          {task.trackerStatus ? (
            <span
              className={`truncate rounded px-1.5 text-[10.5px] font-semibold ${isTesting(task) ? 'bg-purple-500/15 text-purple-500' : TRACKER_STATUS[task.status]}`}
            >
              {task.trackerStatus}
            </span>
          ) : null}
        </span>
        {task.deadlineAt ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] ${
              overdue
                ? 'bg-[var(--tg-theme-destructive-text-color,#d1453b)]/15 text-[var(--tg-theme-destructive-text-color,#d1453b)]'
                : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-hint-color,#8e8e93)]'
            }`}
          >
            {new Date(task.deadlineAt).toLocaleDateString('ru-RU', {
              day: 'numeric',
              month: 'short',
            })}
          </span>
        ) : null}
      </div>

      <p className="mt-1 text-[15px] leading-snug text-[var(--tg-theme-text-color,#000)]">
        {task.title}
      </p>

      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--tg-theme-hint-color,#8e8e93)]">
        {spentMinutes ? (
          <span className="tabular-nums">🕐 сегодня {formatMinutes(spentMinutes)}</span>
        ) : (
          <span>🕐 сегодня не списано</span>
        )}
        {task.projectName ? (
          <>
            <span>·</span>
            <span className="truncate">{task.projectName}</span>
          </>
        ) : null}
      </div>

      {claude?.length ? (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {claude.map(({ session, done, total }) => {
            const st = STATUS[session.status] ?? STATUS.idle
            return (
              <span key={session.id} className="flex items-center gap-1.5 text-[var(--tg-theme-hint-color,#8e8e93)]">
                <span className={`h-2 w-2 rounded-full ${st.dot}`} />
                Claude {st.label}
                {total ? <span className="tabular-nums">· {done === total ? '✅' : '☑'} {done}/{total}</span> : null}
              </span>
            )
          })}
        </div>
      ) : null}
    </Link>
  )
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}м`
  if (!m) return `${h}ч`
  return `${h}ч ${m}м`
}
