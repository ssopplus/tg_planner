'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Plus, Search, X } from 'lucide-react'
import { apiFetch } from '@/lib/telegram/webapp'
import { EmptyState } from '@/components/ui/empty-state'
import { StartTaskButton } from '@/components/cockpit/start-task-button'
import { card, chip, hint, TASK_STATUS, text } from '@/components/cockpit/session-parts'
import type { CockpitPlanIssue, CockpitPlanSnapshot } from '@/lib/db/schema'

interface PlanSession {
  id: string
  name: string
  status: 'waiting' | 'busy' | 'idle'
  taskKey: string | null
  issues: string[]
}

interface PlanData {
  syncedAt: string | null
  plan: CockpitPlanSnapshot | null
  sessions: PlanSession[]
  edits: Record<string, { status: 'pending' | 'sent' | 'done' | 'failed'; error: string | null }>
}

type Notes = CockpitPlanSnapshot['notes']

const PROJECT_KEY = 'plan-project'
const STATUS_RANK: Record<string, number> = { review: 0, inProgress: 1, paused: 2, new: 3 }
const isClosed = (i: CockpitPlanIssue) => i.resolved || i.status?.type === 'done' || i.status?.type === 'cancelled'

/**
 * План задач из dev-cockpit: по проекту — задачи Трекера в том порядке, в
 * каком их собираются делать, и мои открытые задачи, из которых план
 * пополняют. Правка порядка сразу видна здесь и уходит в cockpit командой; там
 * же, на вкладке «План», она появится после следующего синка.
 */
export default function PlanPage() {
  const [data, setData] = useState<PlanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [project, setProjectState] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(0)

  const setProject = (p: string) => {
    setProjectState(p)
    setOpenKey(null)
    try {
      localStorage.setItem(PROJECT_KEY, p)
    } catch {}
  }

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/cockpit/plan')
      if (res.ok) setData((await res.json()) as PlanData)
    } finally {
      setLoading(false)
      setNow(Date.now())
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 10_000)
    return () => clearInterval(timer)
  }, [load])

  const projects = useMemo(() => data?.plan?.projects ?? [], [data])
  // Выбранный проект — из памяти телефона, иначе первый, где план не пустой.
  useEffect(() => {
    if (project || !projects.length) return
    let saved: string | null = null
    try {
      saved = localStorage.getItem(PROJECT_KEY)
    } catch {}
    const p = projects.find((x) => x.project === saved) ?? projects.find((x) => x.plan.length) ?? projects[0]
    const t = setTimeout(() => setProjectState(p.project), 0)
    return () => clearTimeout(t)
  }, [project, projects])

  const entry = projects.find((p) => p.project === project) ?? null
  const notes: Notes = data?.plan?.notes ?? {}
  const sessionsOf = useCallback(
    (key: string) => (data?.sessions ?? []).filter((s) => s.taskKey === key || s.issues.includes(key)),
    [data],
  )

  const save = async (keys: string[]) => {
    if (!entry || !data?.plan) return
    setError(null)
    // Сразу на экране: cockpit применит правку только следующим синком.
    setData({
      ...data,
      plan: { ...data.plan, projects: data.plan.projects.map((p) => (p.project === entry.project ? { ...p, plan: keys } : p)) },
      edits: { ...data.edits, [entry.project]: { status: 'pending', error: null } },
    })
    const res = await apiFetch('/api/cockpit/plan', {
      method: 'POST',
      body: JSON.stringify({ project: entry.project, keys }),
    })
    if (!res.ok) setError(((await res.json()) as { error?: string }).error ?? 'План не сохранился')
    await load()
  }

  if (loading) return <p className={`py-10 text-center text-sm ${hint}`}>Загружаю…</p>

  if (!data?.plan) {
    return (
      <div className="px-4 pt-4">
        <Header syncedAt={data?.syncedAt ?? null} now={now} />
        <EmptyState
          icon="🗂"
          title="cockpit ещё не присылал план"
          description="План приходит из dev-cockpit на рабочей машине — после обновления cockpit и первого синка."
        />
      </div>
    )
  }

  const byKey = new Map((entry?.issues ?? []).map((i) => [i.key, i]))
  const planKeys = entry?.plan ?? []
  const planned = planKeys.map(
    (k): CockpitPlanIssue =>
      byKey.get(k) ?? {
        key: k,
        summary: '',
        status: null,
        resolved: false,
        priority: null,
        type: null,
        assignee: null,
        deadline: null,
        updatedAt: null,
      },
  )
  const closedKeys = planned.filter(isClosed).map((i) => i.key)
  const needle = q.trim().toLowerCase()
  const base = (entry?.issues ?? []).filter((i) => !planKeys.includes(i.key) && !isClosed(i))
  const pool = base
    .filter((i) => !needle || `${i.key} ${i.summary}`.toLowerCase().includes(needle))
    .sort(
      (a, b) =>
        Number(sessionsOf(b.key).length > 0) - Number(sessionsOf(a.key).length > 0) ||
        (STATUS_RANK[a.status?.type ?? ''] ?? 9) - (STATUS_RANK[b.status?.type ?? ''] ?? 9) ||
        String(b.updatedAt).localeCompare(String(a.updatedAt)),
    )
  const edit = entry ? data.edits[entry.project] : undefined

  const move = (i: number, d: -1 | 1) => {
    const next = [...planKeys]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    save(next)
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <Header syncedAt={data.syncedAt} now={now} />

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {projects.map((p) => (
          <button
            key={p.project}
            type="button"
            onClick={() => setProject(p.project)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] ${
              p.project === project
                ? 'bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)]'
                : `bg-[var(--tg-theme-secondary-bg-color,#efeff4)] ${text}`
            }`}
          >
            {p.project}
            {p.plan.length ? ` · ${p.plan.length}` : ''}
          </button>
        ))}
      </div>

      {entry ? (
        <>
          <section className="flex flex-col gap-2">
            <h2 className={`flex items-center gap-2 text-[12px] font-semibold uppercase ${hint}`}>
              План · {planned.length}
              {closedKeys.length ? ` · закрыто ${closedKeys.length}` : ''}
              <span className="flex-1" />
              {closedKeys.length ? (
                <button
                  type="button"
                  onClick={() => save(planKeys.filter((k) => !closedKeys.includes(k)))}
                  className="normal-case text-[12px] font-normal text-[var(--tg-theme-link-color,#007aff)]"
                >
                  убрать закрытые
                </button>
              ) : null}
            </h2>
            {edit && edit.status !== 'done' ? (
              <p className={`text-[12px] ${edit.status === 'failed' ? 'text-red-500' : hint}`}>
                {edit.status === 'failed' ? `cockpit не принял правку: ${edit.error ?? 'ошибка'}` : 'Правка ждёт cockpit на рабочей машине…'}
              </p>
            ) : null}
            {error ? <p className="text-[12px] text-red-500">{error}</p> : null}
            {planned.length ? (
              planned.map((i, n) => (
                <PlanRow
                  key={i.key}
                  issue={i}
                  n={n + 1}
                  notes={notes}
                  sessions={sessionsOf(i.key)}
                  open={openKey === i.key}
                  onToggle={() => setOpenKey(openKey === i.key ? null : i.key)}
                  actions={
                    <>
                      <IconButton label="Выше" disabled={n === 0} onClick={() => move(n, -1)}>
                        <ArrowUp className="h-4 w-4" />
                      </IconButton>
                      <IconButton label="Ниже" disabled={n === planned.length - 1} onClick={() => move(n, 1)}>
                        <ArrowDown className="h-4 w-4" />
                      </IconButton>
                      <IconButton label="Убрать из плана" onClick={() => save(planKeys.filter((k) => k !== i.key))}>
                        <X className="h-4 w-4" />
                      </IconButton>
                    </>
                  }
                />
              ))
            ) : (
              <p className={`rounded-xl border border-dashed border-border px-3 py-2 text-[12px] ${hint}`}>
                План пуст — добавь задачи из списка ниже.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className={`text-[12px] font-semibold uppercase ${hint}`}>
              Мои задачи проекта · {pool.length}
              {pool.length !== base.length ? ` из ${base.length}` : ''}
            </h2>
            <label className={`flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 ${hint}`}>
              <Search className="h-4 w-4 shrink-0" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ключ или название"
                className={`min-w-0 flex-1 bg-transparent text-[14px] outline-none ${text}`}
              />
            </label>
            {entry.error ? <p className="text-[12px] text-red-500">Трекер не ответил cockpit: {entry.error}</p> : null}
            {pool.length ? (
              pool.map((i) => (
                <PlanRow
                  key={i.key}
                  issue={i}
                  notes={notes}
                  sessions={sessionsOf(i.key)}
                  open={openKey === i.key}
                  onToggle={() => setOpenKey(openKey === i.key ? null : i.key)}
                  actions={
                    <IconButton label="В план" onClick={() => save([...planKeys, i.key])}>
                      <Plus className="h-4 w-4" />
                    </IconButton>
                  }
                />
              ))
            ) : (
              <p className={`py-3 text-center text-[12px] ${hint}`}>
                {base.length ? 'Под поиск ничего не подходит' : 'Открытых задач, кроме плана, нет'}
              </p>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}

function Header({ syncedAt, now }: { syncedAt: string | null; now: number }) {
  const ago = syncedAt ? Math.round((now - new Date(syncedAt).getTime()) / 1000) : null
  return (
    <div className="flex items-center justify-between gap-2">
      <h1 className={`text-xl font-bold ${text}`}>План</h1>
      <span className="flex items-center gap-2">
        {ago !== null && ago > 120 ? <span className={`${chip} text-red-500`}>cockpit не на связи</span> : null}
        <Link href="/sessions" className={`${chip} text-[var(--tg-theme-link-color,#007aff)]`}>
          Сессии
        </Link>
      </span>
    </div>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] ${text} disabled:opacity-30`}
    >
      {children}
    </button>
  )
}

function PlanRow({
  issue: i,
  n,
  notes,
  sessions,
  open,
  onToggle,
  actions,
}: {
  issue: CockpitPlanIssue
  n?: number
  notes: Notes
  sessions: PlanSession[]
  open: boolean
  onToggle: () => void
  actions: React.ReactNode
}) {
  const note = notes[i.key]
  const closed = isClosed(i)
  const working = sessions.some((s) => s.status === 'busy' || s.status === 'waiting')
  return (
    <div className={`${card} ${closed ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2 p-2.5">
        {n ? <span className={`w-5 shrink-0 pt-0.5 text-right text-[12px] tabular-nums ${hint}`}>{n}</span> : null}
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 flex-col gap-1 text-left">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <span className="font-semibold text-[var(--tg-theme-link-color,#007aff)]">{i.key}</span>
            {i.status ? (
              <span
                className={`rounded px-1.5 font-semibold ${TASK_STATUS[i.status.type ?? ''] ?? `bg-[var(--tg-theme-secondary-bg-color,#efeff4)] ${hint}`}`}
              >
                {i.status.display}
              </span>
            ) : null}
            {note ? (
              <span className={`tabular-nums ${hint}`}>
                {note.done === note.total ? '✅' : '☑'} {note.done}/{note.total}
              </span>
            ) : null}
            {sessions.length ? (
              <span className={working ? 'text-green-600' : hint}>
                {working ? '●' : '○'} {sessions.length} сесс.
              </span>
            ) : null}
          </span>
          <span className={`text-[13.5px] leading-snug ${text} ${closed ? 'line-through' : ''} ${open ? '' : 'line-clamp-2'}`}>
            {i.summary || 'задача не загрузилась из Трекера'}
          </span>
        </button>
        <span className="flex shrink-0 gap-1">{actions}</span>
      </div>
      {open ? (
        <div className="flex flex-col gap-2 px-2.5 pb-3">
          <p className={`text-[12px] leading-snug ${hint}`}>
            {[i.type, i.priority && `приоритет ${i.priority.toLowerCase()}`, i.assignee ?? 'без исполнителя', i.deadline && `срок ${i.deadline}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {note?.next ? <p className={`text-[12px] leading-snug ${text}`}>Дальше по заметке: {note.next}</p> : null}
          {sessions.length ? (
            <p className={`text-[12px] ${hint}`}>
              Сессии:{' '}
              {sessions.map((s, k) => (
                <span key={s.id}>
                  {k ? ', ' : ''}
                  <Link href={`/sessions/${s.id}`} className="text-[var(--tg-theme-link-color,#007aff)]">
                    {s.name}
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
          <a
            href={`https://tracker.yandex.ru/${i.key}`}
            target="_blank"
            rel="noreferrer"
            className="w-fit text-[12px] text-[var(--tg-theme-link-color,#007aff)]"
          >
            Открыть в Трекере ↗
          </a>
          {!closed ? <StartTaskButton issueKey={i.key} title={i.summary} /> : null}
        </div>
      ) : null}
    </div>
  )
}
