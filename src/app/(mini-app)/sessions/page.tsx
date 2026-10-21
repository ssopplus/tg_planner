'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/telegram/webapp'
import { requestBody } from '@/lib/cockpit/format'
import { EmptyState } from '@/components/ui/empty-state'

interface SessionTask {
  issue: string | null
  title: string
  status?: { display: string; type: string | null } | null
  todo: { done: boolean; text: string }[]
  log?: { date: string; own: boolean; done?: string; left?: string; blockers?: string } | null
}

interface Session {
  id: string
  name: string
  project: string
  status: 'waiting' | 'busy' | 'idle'
  lastAssistant?: string
  taskKey?: string | null
  tasks?: SessionTask[]
  updatedAt: string
}

interface Command {
  id: string
  kind: 'message' | 'start-task'
  sessionId: string | null
  payload: { text?: string; issueKey?: string }
  status: 'pending' | 'sent' | 'done' | 'failed'
  result: { error?: string; output?: string } | null
  createdAt: string
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
  commands: Command[]
}

const STATUS = {
  waiting: { label: 'ждёт', dot: 'bg-amber-500' },
  busy: { label: 'работает', dot: 'bg-blue-500' },
  idle: { label: 'простаивает', dot: 'bg-gray-400' },
} as const

/** Цвет статуса задачи в Трекере по его типу (review — тестирование и ревью). */
const TASK_STATUS: Record<string, string> = {
  inProgress: 'bg-blue-500/15 text-blue-500',
  review: 'bg-purple-500/15 text-purple-500',
  done: 'bg-green-500/15 text-green-600',
  paused: 'bg-amber-500/15 text-amber-600',
}

const COMMAND_STATUS: Record<Command['status'], string> = {
  pending: 'ждёт cockpit',
  sent: 'cockpit выполняет',
  done: 'доставлено',
  failed: 'не вышло',
}

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
          {tasks.map((t) => (
            <TaskDetail key={t.issue ?? t.title} t={t} />
          ))}
          <Composer sessionId={s.id} commands={commands} onSent={onSent} />
        </div>
      ) : null}
    </li>
  )
}

function TaskBadge({ t, showKey }: { t: SessionTask; showKey: boolean }) {
  const done = t.todo.filter((x) => x.done).length
  return (
    <span className="flex items-center gap-1.5 text-[11px]">
      {t.status ? (
        <span className={`rounded px-1.5 font-semibold ${TASK_STATUS[t.status.type ?? ''] ?? `bg-[var(--tg-theme-secondary-bg-color,#efeff4)] ${hint}`}`}>
          {t.status.display}
        </span>
      ) : null}
      {showKey && t.issue ? <span className="font-semibold text-[var(--tg-theme-link-color,#007aff)]">{t.issue}</span> : null}
      {t.todo.length ? (
        <span className={`tabular-nums ${hint}`}>
          {done === t.todo.length ? '✅' : '☑'} {done}/{t.todo.length}
        </span>
      ) : null}
    </span>
  )
}

/** План и запись ворклога из заметки start-task. */
function TaskDetail({ t }: { t: SessionTask }) {
  const field = (label: string, value?: string) =>
    value ? (
      <div>
        <p className={`text-[11px] font-semibold uppercase ${hint}`}>{label}</p>
        <p className={`whitespace-pre-wrap text-[12.5px] leading-snug ${text}`}>{value}</p>
      </div>
    ) : null
  return (
    <section className="flex flex-col gap-2 rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] p-2.5">
      <p className={`text-[13px] font-semibold ${text}`}>
        {t.issue ? `${t.issue} · ` : ''}
        {t.title}
      </p>
      {t.todo.length ? (
        <ul className="flex flex-col gap-0.5">
          {t.todo.map((x, i) => (
            <li key={i} className={`flex gap-1.5 text-[12.5px] leading-snug ${x.done ? `${hint} line-through` : text}`}>
              <span className="shrink-0">{x.done ? '✓' : '○'}</span>
              <span>{x.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {t.log ? (
        <>
          <p className={`text-[11px] ${hint}`}>Ворклог · {t.log.date}{t.log.own ? ' · эта сессия' : ' · последняя запись'}</p>
          {field('Сделано', t.log.done)}
          {field('Осталось', t.log.left)}
          {t.log.blockers && !/^нет\.?$/i.test(t.log.blockers) ? field('Блокеры', t.log.blockers) : null}
        </>
      ) : (
        <p className={`text-[12px] ${hint}`}>Ворклога нет — его ведёт /start-task.</p>
      )}
    </section>
  )
}

/** Текст в сессию: уходит через cockpit в её межсессионный сокет. */
function Composer({ sessionId, commands, onSent }: { sessionId: string; commands: Command[]; onSent: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    if (!value.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch('/api/cockpit/commands', {
        method: 'POST',
        body: JSON.stringify({ kind: 'message', sessionId, text: value }),
      })
      if (!res.ok) setError(((await res.json()) as { error?: string }).error ?? 'Ошибка')
      else setValue('')
      onSent()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder="Написать в сессию…"
        className={`rounded-lg border border-border bg-transparent px-2 py-1.5 text-[14px] ${text}`}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !value.trim()}
          onClick={send}
          className="rounded-lg bg-[var(--tg-theme-button-color,#007aff)] px-3 py-2 text-[13px] text-[var(--tg-theme-button-text-color,#fff)] disabled:opacity-50"
        >
          Отправить
        </button>
        <span className={`text-[11px] leading-snug ${hint}`}>
          Claude получит это как реплику соседней сессии с пометкой «из dev-cockpit».
        </span>
      </div>
      {error ? <p className="text-[12px] text-red-500">{error}</p> : null}
      {commands.slice(0, 3).map((c) => (
        <p key={c.id} className={`truncate text-[11px] ${c.status === 'failed' ? 'text-red-500' : hint}`}>
          {COMMAND_STATUS[c.status]}
          {c.result?.error ? ` (${c.result.error})` : ''}: {c.payload.text}
        </p>
      ))}
    </div>
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
