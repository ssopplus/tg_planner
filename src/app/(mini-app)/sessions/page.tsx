'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/telegram/webapp'
import { requestBody } from '@/lib/cockpit/format'
import { EmptyState } from '@/components/ui/empty-state'

interface Session {
  id: string
  name: string
  project: string
  status: 'waiting' | 'busy' | 'idle'
  lastAssistant?: string
  updatedAt: string
}

interface Question {
  question: string
  header?: string
  multiSelect?: boolean
  options: { label: string; description?: string }[]
}

interface Request {
  id: string
  sessionId: string
  sessionName: string
  project: string | null
  kind: 'permission' | 'question'
  toolName: string
  summary: string
  payload: Record<string, unknown> & { questions?: Question[] }
  canAlways: boolean
  status: string
  decision: { behavior: 'allow' | 'deny'; always?: boolean; answers?: Record<string, string> } | null
  createdAt: string
}

interface CockpitData {
  syncedAt: string | null
  sessions: Session[]
  requests: Request[]
}

const STATUS = {
  waiting: { label: 'ждёт', dot: 'bg-amber-500' },
  busy: { label: 'работает', dot: 'bg-blue-500' },
  idle: { label: 'простаивает', dot: 'bg-gray-400' },
} as const

const CLOSED: Record<string, string> = {
  answered: 'отвечено',
  'answered-elsewhere': 'ответили в VS Code',
  expired: 'истекло',
}

const hint = 'text-[var(--tg-theme-hint-color,#8e8e93)]'
const text = 'text-[var(--tg-theme-text-color,#000)]'
const card = 'rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)]'
const chip = 'rounded-full bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-3 py-1.5 text-[12px]'

/** Сколько секунд снимок может не обновляться, прежде чем cockpit считается отвалившимся. */
const STALE_SEC = 120

/**
 * Сессии Claude Code с рабочей машины — по снимку, который присылает
 * dev-cockpit. Переписки и diff здесь нет намеренно: они не уходят с машины.
 * Запросы разрешений и вопросы Claude можно решить прямо тут; до сессии
 * решение доносит cockpit следующим синком.
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
                    <SessionRow key={s.id} s={s} />
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

function SessionRow({ s }: { s: Session }) {
  const [open, setOpen] = useState(false)
  const st = STATUS[s.status] ?? STATUS.idle
  return (
    <li>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-col gap-1 p-3 text-left">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
          <span className={`min-w-0 flex-1 truncate text-[14px] ${text}`}>{s.name}</span>
          <span className={`text-[11px] ${hint}`}>{st.label}</span>
        </span>
        {s.lastAssistant ? (
          <span className={`whitespace-pre-wrap text-[12px] leading-snug ${hint} ${open ? '' : 'line-clamp-2'}`}>
            {s.lastAssistant}
          </span>
        ) : null}
      </button>
    </li>
  )
}

function RequestCard({ req, onDone }: { req: Request; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const questions = req.kind === 'question' ? (req.payload.questions ?? []) : []

  const submit = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/cockpit/requests/${req.id}`, { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) setError(((await res.json()) as { error?: string }).error ?? 'Ошибка')
      onDone()
    } finally {
      setBusy(false)
    }
  }

  const toggle = (q: Question, label: string) =>
    setPicked((p) => {
      const cur = p[q.question] ?? []
      const next = q.multiSelect ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label]
      return { ...p, [q.question]: next }
    })
  const allPicked = questions.every((q) => (picked[q.question] ?? []).length > 0)

  return (
    <section className={`${card} flex flex-col gap-2 border-amber-400 p-3`}>
      <p className={`text-[12px] ${hint}`}>
        {req.kind === 'question' ? '❓ Вопрос Claude' : '🔐 Запрос разрешения'}
        {req.project ? ` · ${req.project}` : ''}
      </p>
      <p className={`text-[14px] font-semibold ${text}`}>{req.sessionName}</p>

      {req.kind === 'permission' ? (
        <>
          <p className={`text-[12px] ${hint}`}>
            <span className="font-mono">{req.toolName}</span>
            {typeof req.payload.description === 'string' ? ` — ${req.payload.description}` : ''}
          </p>
          <pre className={`max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] p-2 font-mono text-[11px] ${text}`}>
            {requestBody(req.toolName, req.payload)}
          </pre>
        </>
      ) : (
        questions.map((q) => (
          <div key={q.question} className="flex flex-col gap-1.5">
            <p className={`text-[13px] ${text}`}>
              {q.header ? <b>{q.header}. </b> : null}
              {q.question}
            </p>
            {q.options.map((o) => {
              const on = (picked[q.question] ?? []).includes(o.label)
              return (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => toggle(q, o.label)}
                  className={`rounded-lg border p-2 text-left text-[13px] ${on ? 'border-[var(--tg-theme-button-color,#007aff)]' : 'border-border'} ${text}`}
                >
                  {q.multiSelect ? (on ? '☑ ' : '☐ ') : on ? '● ' : '○ '}
                  {o.label}
                  {o.description ? <span className={`block text-[11px] ${hint}`}>{o.description}</span> : null}
                </button>
              )
            })}
          </div>
        ))
      )}

      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Причина отказа (необязательно)"
        className={`rounded-lg border border-border bg-transparent px-2 py-1.5 text-[13px] ${text}`}
      />
      <div className="flex flex-wrap gap-2">
        {req.kind === 'permission' ? (
          <>
            <button type="button" disabled={busy} onClick={() => submit({ behavior: 'allow' })} className="rounded-lg bg-green-600 px-3 py-2 text-[13px] text-white disabled:opacity-50">
              Разрешить
            </button>
            {req.canAlways ? (
              <button type="button" disabled={busy} onClick={() => submit({ behavior: 'allow', always: true })} className={`${chip} ${text} disabled:opacity-50`}>
                Разрешить всегда
              </button>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            disabled={busy || !allPicked}
            onClick={() => submit({ answers: Object.fromEntries(Object.entries(picked).map(([q, ls]) => [q, ls.join(', ')])) })}
            className="rounded-lg bg-green-600 px-3 py-2 text-[13px] text-white disabled:opacity-50"
          >
            Ответить
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => submit({ behavior: 'deny', message: reason || undefined })} className="rounded-lg bg-red-600 px-3 py-2 text-[13px] text-white disabled:opacity-50">
          Отклонить
        </button>
      </div>
      {error ? <p className="text-[12px] text-red-500">{error}</p> : null}
    </section>
  )
}
