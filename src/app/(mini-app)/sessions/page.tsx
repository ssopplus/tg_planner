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
  MoveToVSCode,
  ModeChip,
  readSeen,
  RequestCard,
  TaskBadge,
  TaskDetail,
  text,
  writeSeen,
  type Command,
  type Request,
  type Session,
  type SessionTask,
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

/**
 * Колонки доски cockpit. «Готово, посмотреть» — сессия что-то сделала после
 * последнего просмотра (за неделю); «Простаивает» — всё остальное, свёрнуто.
 */
type Lane = 'waiting' | 'busy' | 'review' | 'idle'
const LANES: { key: Lane; label: string; dot: string }[] = [
  { key: 'waiting', label: 'Ждёт меня', dot: 'bg-amber-500' },
  { key: 'busy', label: 'Работает', dot: 'bg-green-500' },
  { key: 'review', label: 'Готово, посмотреть', dot: 'bg-blue-500' },
  { key: 'idle', label: 'Простаивает', dot: 'bg-gray-400' },
]
const LANE_ORDER: Lane[] = LANES.map((l) => l.key)
const REVIEW_WINDOW_MS = 7 * 86400e3

function laneOf(s: Session, seen: Record<string, number>, now: number): Lane {
  if (s.status === 'waiting') return 'waiting'
  if (s.status === 'busy') return 'busy'
  const at = new Date(s.updatedAt).getTime()
  if (at > (seen[s.id] ?? 0) && now - at < REVIEW_WINDOW_MS) return 'review'
  return 'idle'
}

/** Фильтры — удобство одного телефона: в localStorage, без него просто не запоминаются. */
const FILTERS_KEY = 'sessions-filters'
/** `projects` пустой — все проекты. */
type Filters = { view: 'lanes' | 'projects'; projects: string[]; q: string; showIdle: boolean }
const DEFAULT_FILTERS: Filters = { view: 'lanes', projects: [], q: '', showIdle: false }
function readFilters(): Filters {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '{}') as Partial<Filters> & { project?: string }
    // До множественного выбора хранился один `project`.
    const projects = Array.isArray(saved.projects) ? saved.projects : saved.project ? [saved.project] : []
    return {
      view: saved.view === 'projects' ? 'projects' : 'lanes',
      projects,
      q: saved.q ?? '',
      showIdle: saved.showIdle === true,
    }
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

const projectOf = (s: Session) => s.project || 'Без проекта'

/**
 * Сессии Claude Code с рабочей машины — доской, как в dev-cockpit: колонки
 * «Ждёт меня · Работает · Готово, посмотреть · Простаивает» друг под другом
 * или группы по проектам. Запросы разрешений и вопросы решаются прямо тут; до
 * сессии решение доносит cockpit следующим синком. Переписка — на странице
 * сессии и только пока её открыли: без этого она с машины не уходит.
 */
export default function SessionsPage() {
  const [data, setData] = useState<CockpitData | null>(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const [seen, setSeenState] = useState<Record<string, number>>({})
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_FILTERS)
  const setFilters = (patch: Partial<Filters>) =>
    setFiltersState((f) => {
      const next = { ...f, ...patch }
      saveFilters(next)
      return next
    })

  // Сохранённое — после монтирования: localStorage на сервере нет.
  useEffect(() => {
    const t = setTimeout(() => {
      setFiltersState(readFilters())
      setSeenState(readSeen() ?? {})
    }, 0)
    return () => clearTimeout(t)
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/cockpit')
      if (!res.ok) return
      const next = (await res.json()) as CockpitData
      setData(next)
      // Первый запуск: всё, что было до него, считаем просмотренным — иначе в
      // «Готово, посмотреть» разом окажутся все сессии за неделю.
      if (readSeen() === null && next.sessions.length) {
        const all = Object.fromEntries(next.sessions.map((s) => [s.id, new Date(s.updatedAt).getTime()]))
        writeSeen(all)
        setSeenState(all)
      }
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

  const markSeen = (list: Session[]) => {
    const next = { ...seen }
    for (const s of list) next[s.id] = Math.max(next[s.id] ?? 0, new Date(s.updatedAt).getTime())
    writeSeen(next)
    setSeenState(next)
  }

  const sessions = useMemo(() => data?.sessions ?? [], [data])
  // Выбранные остаются в списке, даже если их сессии закрылись, — иначе чип не снять.
  const projects = useMemo(
    () => [...new Set([...sessions.map(projectOf), ...filters.projects])].sort(),
    [sessions, filters.projects],
  )
  const shown = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return sessions
      .filter((s) => !filters.projects.length || filters.projects.includes(projectOf(s)))
      .filter(
        (s) =>
          !q ||
          [s.name, s.project, s.taskKey, ...(s.tasks ?? []).flatMap((t) => [t.issue, t.title])]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
      )
      .map((s) => ({ s, lane: laneOf(s, seen, now) }))
      .sort((a, b) => new Date(b.s.updatedAt).getTime() - new Date(a.s.updatedAt).getTime())
  }, [sessions, filters.projects, filters.q, seen, now])

  if (loading) return <p className={`py-10 text-center text-sm ${hint}`}>Загружаю…</p>

  const ago = data?.syncedAt ? Math.round((now - new Date(data.syncedAt).getTime()) / 1000) : null
  // Старые сверху: новый запрос встаёт в конец и не сдвигает кнопки под пальцем.
  const pending = data?.requests.filter((r) => r.status === 'pending').reverse() ?? []
  const closed = data?.requests.filter((r) => r.status !== 'pending').slice(0, 10) ?? []
  const requestsOf = (id: string) => pending.filter((r) => r.sessionId === id)

  const cardOf = ({ s, lane }: { s: Session; lane: Lane }, opts: { showProject: boolean }) => (
    <SessionCard
      key={s.id}
      s={s}
      lane={lane}
      ago={activityAgo(s.updatedAt, now)}
      showProject={opts.showProject}
      request={requestsOf(s.id)[0]}
      commands={data?.commands.filter((c) => c.sessionId === s.id) ?? []}
      onSent={load}
      onSeen={() => markSeen([s])}
    />
  )

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className={`text-xl font-bold ${text}`}>Сессии</h1>
        <span className="flex items-center gap-2">
          {ago !== null ? (
            <span className={`${chip} ${ago > STALE_SEC ? 'text-red-500' : hint}`}>
              {ago > STALE_SEC ? 'cockpit не на связи' : `обновлено ${ago < 5 ? 'только что' : `${ago} с назад`}`}
            </span>
          ) : null}
          <Link href="/plan" className={`${chip} text-[var(--tg-theme-link-color,#007aff)]`}>
            План
          </Link>
        </span>
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
                { id: 'lanes', label: 'По статусам' },
                { id: 'projects', label: 'По проектам' },
              ]}
              activeId={filters.view}
              onSelect={(id) => setFilters({ view: id as Filters['view'] })}
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

          {shown.length === 0 ? (
            <p className={`py-6 text-center text-sm ${hint}`}>
              {sessions.length === 0 ? 'Открытых сессий нет' : 'Под фильтр ничего не подходит'}
            </p>
          ) : filters.view === 'lanes' ? (
            LANES.map((l) => {
              const list = shown.filter((x) => x.lane === l.key)
              const folded = l.key === 'idle' && !filters.showIdle
              return (
                <section key={l.key} className="flex flex-col gap-2">
                  <h2 className={`flex items-center gap-2 text-[12px] font-semibold uppercase ${hint}`}>
                    <span className={`h-2 w-2 rounded-full ${l.dot}`} />
                    {l.label} · {list.length}
                    <span className="flex-1" />
                    {l.key === 'review' && list.length ? (
                      <button
                        type="button"
                        onClick={() => markSeen(list.map((x) => x.s))}
                        className="normal-case text-[12px] font-normal text-[var(--tg-theme-link-color,#007aff)]"
                      >
                        отметить все
                      </button>
                    ) : null}
                    {l.key === 'idle' && list.length ? (
                      <button
                        type="button"
                        onClick={() => setFilters({ showIdle: !filters.showIdle })}
                        className="normal-case text-[12px] font-normal text-[var(--tg-theme-link-color,#007aff)]"
                      >
                        {folded ? 'показать' : 'скрыть'}
                      </button>
                    ) : null}
                  </h2>
                  {folded ? null : list.length ? (
                    list.map((x) => cardOf(x, { showProject: true }))
                  ) : (
                    <p className={`rounded-xl border border-dashed border-border px-3 py-2 text-[12px] ${hint}`}>
                      {l.key === 'waiting' ? 'Никто не ждёт 🎉' : 'Пусто'}
                    </p>
                  )}
                </section>
              )
            })
          ) : (
            <ProjectGroups shown={shown} cardOf={cardOf} />
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

/** Группы по проектам, как «По проектам» на доске: сверху проекты, где кто-то ждёт или работает. */
function ProjectGroups({
  shown,
  cardOf,
}: {
  shown: { s: Session; lane: Lane }[]
  cardOf: (x: { s: Session; lane: Lane }, opts: { showProject: boolean }) => React.ReactNode
}) {
  const groups = new Map<string, { s: Session; lane: Lane }[]>()
  for (const x of shown) groups.set(projectOf(x.s), [...(groups.get(projectOf(x.s)) ?? []), x])
  const rank = (xs: { lane: Lane }[]) => Math.min(...xs.map((x) => LANE_ORDER.indexOf(x.lane)))
  const ordered = [...groups].sort((a, b) => rank(a[1]) - rank(b[1]) || a[0].localeCompare(b[0]))
  return ordered.map(([project, list]) => {
    const sorted = [...list].sort((a, b) => LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane))
    const counts = LANES.filter((l) => l.key !== 'idle')
      .map((l) => ({ l, n: list.filter((x) => x.lane === l.key).length }))
      .filter((c) => c.n)
    return (
      <section key={project} className="flex flex-col gap-2">
        <h2 className={`flex flex-wrap items-center gap-x-2 text-[13px] font-semibold ${text}`}>
          {project}
          <span className={`text-[12px] font-normal ${hint}`}>
            {list.length} сесс.
            {counts.length ? counts.map((c) => ` · ${c.l.label.toLowerCase()} ${c.n}`).join('') : ' · всё простаивает'}
          </span>
        </h2>
        {sorted.map((x) => cardOf(x, { showProject: false }))}
      </section>
    )
  })
}

/** Первый невыполненный пункт плана и доля сделанного — как полоса во «Входящих» cockpit. */
function PlanBar({ t, showKey }: { t: SessionTask; showKey: boolean }) {
  if (!t.todo.length) return null
  const done = t.todo.filter((x) => x.done).length
  const next = t.todo.find((x) => !x.done)?.text
  return (
    <span className={`flex min-w-0 items-center gap-2 text-[11.5px] ${hint}`}>
      {showKey && t.issue ? <span className="shrink-0 font-semibold text-[var(--tg-theme-link-color,#007aff)]">{t.issue}</span> : null}
      <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-black/10">
        <span className="block h-full rounded-full bg-green-600" style={{ width: `${Math.round((done / t.todo.length) * 100)}%` }} />
      </span>
      {next ? <span className="truncate">дальше: {next}</span> : <span className="text-green-600">план выполнен</span>}
    </span>
  )
}

function SessionCard({
  s,
  lane,
  ago,
  showProject,
  request,
  commands,
  onSent,
  onSeen,
}: {
  s: Session
  lane: Lane
  ago: string
  showProject: boolean
  request?: Request
  commands: Command[]
  onSent: () => void
  onSeen: () => void
}) {
  const [open, setOpen] = useState(false)
  const dot = LANES.find((l) => l.key === lane)?.dot ?? 'bg-gray-400'
  const tasks = s.tasks ?? []
  // Простаивающие — одной строкой, как свёрнутые карточки на доске.
  const compact = lane === 'idle' && !open
  const showKey = (t: SessionTask) => tasks.length > 1 || !s.name.includes(t.issue ?? '')

  return (
    <div
      className={`${card} border-l-[3px] ${
        lane === 'waiting'
          ? 'border-l-amber-500'
          : lane === 'busy'
            ? 'border-l-green-500'
            : lane === 'review'
              ? 'border-l-blue-500'
              : 'border-l-gray-400'
      }`}
    >
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-col gap-1 p-2.5 text-left">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
          <span className={`min-w-0 flex-1 truncate text-[14px] font-semibold ${text}`}>{s.name}</span>
          <span className={`shrink-0 text-[11px] ${hint}`}>{ago}</span>
        </span>
        {showProject || tasks.length || !['default', 'manual', null, undefined].includes(s.permissionMode) ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {showProject ? <span className={`rounded bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-1.5 text-[11px] ${hint}`}>{projectOf(s)}</span> : null}
            <ModeChip mode={s.permissionMode} quiet />
            {tasks.map((t) => (
              <TaskBadge key={t.issue ?? t.title} t={t} showKey={showKey(t)} />
            ))}
          </span>
        ) : null}
        {!compact
          ? tasks.map((t) => <PlanBar key={t.issue ?? t.title} t={t} showKey={tasks.filter((x) => x.todo.length).length > 1} />)
          : null}
        {request ? (
          <span className="truncate text-[12px] font-medium text-amber-600">
            {request.kind === 'question' ? '❓ вопрос' : `🔐 ${request.toolName}`}: {request.summary}
          </span>
        ) : s.waitingFor ? (
          <span className="text-[12px] leading-snug text-amber-600">⏳ Ждёт {s.waitingFor}</span>
        ) : null}
        {s.lastAssistant && !compact ? (
          <span className={`whitespace-pre-wrap text-[12px] leading-snug ${hint} ${open ? '' : 'line-clamp-2'}`}>
            {s.lastAssistant}
          </span>
        ) : null}
      </button>
      {lane === 'review' && !open ? (
        <div className="px-2.5 pb-2.5">
          <button type="button" onClick={onSeen} className={`${chip} ${text}`}>
            ✓ просмотрено
          </button>
        </div>
      ) : null}
      {open ? (
        <div className="flex flex-col gap-3 px-2.5 pb-3">
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/sessions/${s.id}`}
              className="w-fit rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-3 py-1.5 text-[13px] font-medium text-[var(--tg-theme-link-color,#007aff)]"
            >
              Открыть переписку →
            </Link>
            {lane === 'review' ? (
              <button type="button" onClick={onSeen} className={`${chip} ${text}`}>
                ✓ просмотрено
              </button>
            ) : null}
          </div>
          {s.background ? <MoveToVSCode sessionId={s.id} commands={commands} onSent={onSent} /> : null}
          {tasks.map((t) => (
            <TaskDetail key={t.issue ?? t.title} t={t} />
          ))}
          <Composer sessionId={s.id} commands={commands} onSent={onSent} />
        </div>
      ) : null}
    </div>
  )
}
