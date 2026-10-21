'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/telegram/webapp'
import { EmptyState } from '@/components/ui/empty-state'
import {
  card,
  chip,
  Composer,
  hint,
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

  if (loading) return <p className={`py-10 text-center text-sm ${hint}`}>Загружаю…</p>

  const ago = data?.syncedAt ? Math.round((now - new Date(data.syncedAt).getTime()) / 1000) : null
  const pending = data?.requests.filter((r) => r.status === 'pending') ?? []
  const closed = data?.requests.filter((r) => r.status !== 'pending').slice(0, 10) ?? []
  const groups = new Map<string, Session[]>()
  for (const s of data?.sessions ?? []) {
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
            <RequestCard key={r.id} req={r} onDone={load} />
          ))}

          {ordered.length === 0 ? (
            <p className={`py-6 text-center text-sm ${hint}`}>Открытых сессий нет</p>
          ) : (
            ordered.map(([project, list]) => (
              <section key={project} className={card}>
                <h2 className={`px-3 pt-3 text-[13px] font-semibold ${text}`}>{project}</h2>
                <ul className="flex flex-col divide-y divide-border">
                  {list.map((s) => (
                    <SessionRow
                      key={s.id}
                      s={s}
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

function SessionRow({ s, commands, onSent }: { s: Session; commands: Command[]; onSent: () => void }) {
  const [open, setOpen] = useState(false)
  const st = STATUS[s.status] ?? STATUS.idle
  const tasks = s.tasks ?? []
  return (
    <li>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-col gap-1 p-3 text-left">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
          <span className={`min-w-0 flex-1 truncate text-[14px] ${text}`}>{s.name}</span>
          <span className={`text-[11px] ${hint}`}>{st.label}</span>
        </span>
        {tasks.length ? (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {tasks.map((t) => (
              <TaskBadge key={t.issue ?? t.title} t={t} showKey={tasks.length > 1 || !s.name.includes(t.issue ?? '')} />
            ))}
          </span>
        ) : null}
        {s.lastAssistant ? (
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
