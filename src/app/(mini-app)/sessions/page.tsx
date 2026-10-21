'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { apiFetch } from '@/lib/telegram/webapp'
import { EmptyState } from '@/components/ui/empty-state'
import { TabStrip } from '@/components/ui/tab-strip'
import {
  card,
  chip,
  Composer,
  hint,
  ModeChip,
  RequestCard,
  STATUS,
  TaskBadge,
  TaskDetail,
  text,
  type Command,
  type Request,
  type Session,
} from '@/components/cockpit/session-parts'

interface CockpitData {
  syncedAt: string | null
  sessions: Session[]
  requests: Request[]
  commands: Command[]
}

const CLOSED: Record<string, string> = {
  answered: 'отвечено',
  'answered-elsewhere': 'ответили в VS Code',
  expired: 'истекло',
}

/** Сколько секунд снимок может не обновляться, прежде чем cockpit считается отвалившимся. */
const STALE_SEC = 120

/** Активная сессия — ждёт, работает или что-то делала за последние столько часов. */
const ACTIVE_MS = 3 * 3600e3

const isActive = (s: Session, now: number) =>
  s.status !== 'idle' || now - new Date(s.updatedAt).getTime() < ACTIVE_MS

/** Фильтры — удобство одного телефона: в localStorage, без него просто не запоминаются. */
const FILTERS_KEY = 'sessions-filters'
/** `projects` пустой — все проекты. */
type Filters = { tab: 'active' | 'inactive'; projects: string[]; q: string }
const DEFAULT_FILTERS: Filters = { tab: 'active', projects: [], q: '' }
function readFilters(): Filters {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '{}') as Partial<Filters> & { project?: string }
    // До множественного выбора хранился один `project`.
    const projects = Array.isArray(saved.projects) ? saved.projects : saved.project ? [saved.project] : []
    return { tab: saved.tab === 'inactive' ? 'inactive' : 'active', projects, q: saved.q ?? '' }
  } catch {
    return DEFAULT_FILTERS
  }
}
function saveFilters(f: Filters) {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(f))
  } catch {}
}

function activityAgo(iso: string, now: number) {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60e3))
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин`
  if (min < 48 * 60) return `${Math.round(min / 60)} ч`
  return `${Math.round(min / 1440)} д`
}

/**
 * Сессии Claude Code с рабочей машины — по снимку, который присылает
 * dev-cockpit. Запросы разрешений и вопросы Claude можно решить прямо тут; до
 * сессии решение доносит cockpit следующим синком. Переписка — на странице
 * сессии и только пока её открыли: без этого она с машины не уходит.
 */
export default function SessionsPage() {
  const [data, setData] = useState<CockpitData | null>(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_FILTERS)
  const setFilters = (patch: Partial<Filters>) =>
    setFiltersState((f) => {
      const next = { ...f, ...patch }
      saveFilters(next)
      return next
    })

  // Сохранённые фильтры — после монтирования: localStorage на сервере нет.
  useEffect(() => {
    const t = setTimeout(() => setFiltersState(readFilters()), 0)
    return () => clearTimeout(t)
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/cockpit')
      if (res.ok) setData((await res.json()) as CockpitData)
    } finally {
      setLoading(false)
      setNow(Date.now())
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 5000)
    return () => clearInterval(timer)
  }, [load])

  const sessions = useMemo(() => data?.sessions ?? [], [data])
  // Выбранные остаются в списке, даже если их сессии закрылись, — иначе чип не снять.
  const projects = useMemo(
    () => [...new Set([...sessions.map((s) => s.project || 'Без проекта'), ...filters.projects])].sort(),
    [sessions, filters.projects],
  )
  const activeCount = sessions.filter((s) => isActive(s, now)).length
  const shown = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return sessions
      .filter((s) => isActive(s, now) === (filters.tab === 'active'))
      .filter((s) => !filters.projects.length || filters.projects.includes(s.project || 'Без проекта'))
      .filter(
        (s) =>
          !q ||
          [s.name, s.project, s.taskKey, ...(s.tasks ?? []).flatMap((t) => [t.issue, t.title])]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
      )
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [sessions, filters, now])

  if (loading) return <p className={`py-10 text-center text-sm ${hint}`}>Загружаю…</p>

  const ago = data?.syncedAt ? Math.round((now - new Date(data.syncedAt).getTime()) / 1000) : null
  const pending = data?.requests.filter((r) => r.status === 'pending') ?? []
  const closed = data?.requests.filter((r) => r.status !== 'pending').slice(0, 10) ?? []
  const groups = new Map<string, Session[]>()
  for (const s of shown) {
    const key = s.project || 'Без проекта'
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  const rank = (ss: Session[]) => Math.min(...ss.map((s) => ['waiting', 'busy', 'idle'].indexOf(s.status)))
  const ordered = [...groups].sort((a, b) => rank(a[1]) - rank(b[1]) || a[0].localeCompare(b[0]))

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className={`text-xl font-bold ${text}`}>Сессии</h1>
        {ago !== null ? (
          <span className={`${chip} ${ago > STALE_SEC ? 'text-red-500' : hint}`}>
            {ago > STALE_SEC ? 'cockpit не на связи' : `обновлено ${ago < 5 ? 'только что' : `${ago} с назад`}`}
          </span>
        ) : null}
      </div>

      {!data?.syncedAt ? (
        <EmptyState
          icon="🛰"
          title="dev-cockpit ещё не присылал данных"
          description="Синк включается на рабочей машине: cockpit/data/sync.json с адресом и секретом."
        />
      ) : (
        <>
          {pending.map((r) => (
            <RequestCard
              key={r.id}
              req={r}
              mode={data.sessions.find((s) => s.id === r.sessionId)?.permissionMode}
              onDone={load}
            />
          ))}

          <div className="-mx-4">
            <TabStrip
              items={[
                { id: 'active', label: 'Активные', count: activeCount },
                { id: 'inactive', label: 'Неактивные', count: sessions.length - activeCount },
              ]}
              activeId={filters.tab}
              onSelect={(id) => setFilters({ tab: id as Filters['tab'] })}
            />
          </div>
          <label className={`flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 ${hint}`}>
            <Search className="h-4 w-4 shrink-0" />
            <input
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value })}
              placeholder="Имя, задача, проект"
              className={`min-w-0 flex-1 bg-transparent text-[14px] outline-none ${text}`}
            />
          </label>
          {projects.length > 1 ? (
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
              {['', ...projects].map((p) => (
                <button
                  key={p || 'all'}
                  type="button"
                  onClick={() =>
                    setFilters({
                      projects: !p
                        ? []
                        : filters.projects.includes(p)
                          ? filters.projects.filter((x) => x !== p)
                          : [...filters.projects, p],
                    })
                  }
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] ${
                    (p ? filters.projects.includes(p) : !filters.projects.length)
                      ? 'bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)]'
                      : `bg-[var(--tg-theme-secondary-bg-color,#efeff4)] ${text}`
                  }`}
                >
                  {p || 'Все проекты'}
                </button>
              ))}
            </div>
          ) : null}

          {ordered.length === 0 ? (
            <p className={`py-6 text-center text-sm ${hint}`}>
              {sessions.length === 0
                ? 'Открытых сессий нет'
                : filters.q || filters.projects.length
                  ? 'Под фильтр ничего не подходит'
                  : filters.tab === 'active'
                    ? 'Активных сессий нет — все простаивают дольше 3 часов'
                    : 'Неактивных сессий нет'}
            </p>
          ) : (
            ordered.map(([project, list]) => (
              <section key={project} className={card}>
                <h2 className={`px-3 pt-3 text-[13px] font-semibold ${text}`}>{project}</h2>
                <ul className="flex flex-col divide-y divide-border">
                  {list.map((s) => (
                    <SessionRow
                      key={s.id}
                      s={s}
                      ago={activityAgo(s.updatedAt, now)}
                      compact={filters.tab === 'inactive'}
                      commands={data.commands.filter((c) => c.sessionId === s.id)}
                      onSent={load}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}

          {closed.length ? (
            <section className="flex flex-col gap-1">
              <h2 className={`text-[12px] font-semibold uppercase ${hint}`}>Закрытые за час</h2>
              {closed.map((r) => (
                <p key={r.id} className={`truncate text-[12px] ${hint}`}>
                  {r.decision?.behavior === 'deny' ? '❌' : '✓'} {r.sessionName} · {r.summary} —{' '}
                  {CLOSED[r.status] ?? r.status}
                </p>
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}

function SessionRow({
  s,
  ago,
  compact,
  commands,
  onSent,
}: {
  s: Session
  ago: string
  /** Неактивные — одной строкой, без последней реплики (раскрываются по нажатию). */
  compact: boolean
  commands: Command[]
  onSent: () => void
}) {
  const [open, setOpen] = useState(false)
  const st = STATUS[s.status] ?? STATUS.idle
  const tasks = s.tasks ?? []
  return (
    <li>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-col gap-1 p-3 text-left">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
          <span className={`min-w-0 flex-1 truncate text-[14px] ${text}`}>{s.name}</span>
          <span className={`shrink-0 text-[11px] ${hint}`}>
            {st.label} · {ago}
          </span>
        </span>
        {tasks.length || !['default', 'manual', null, undefined].includes(s.permissionMode) ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ModeChip mode={s.permissionMode} quiet />
            {tasks.map((t) => (
              <TaskBadge key={t.issue ?? t.title} t={t} showKey={tasks.length > 1 || !s.name.includes(t.issue ?? '')} />
            ))}
          </span>
        ) : null}
        {s.lastAssistant && (open || !compact) ? (
          <span className={`whitespace-pre-wrap text-[12px] leading-snug ${hint} ${open ? '' : 'line-clamp-2'}`}>
            {s.lastAssistant}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="flex flex-col gap-3 px-3 pb-3">
          <Link
            href={`/sessions/${s.id}`}
            className="w-fit rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-3 py-1.5 text-[13px] font-medium text-[var(--tg-theme-link-color,#007aff)]"
          >
            Открыть переписку →
          </Link>
          {tasks.map((t) => (
            <TaskDetail key={t.issue ?? t.title} t={t} />
          ))}
          <Composer sessionId={s.id} commands={commands} onSent={onSent} />
        </div>
      ) : null}
    </li>
  )
}
