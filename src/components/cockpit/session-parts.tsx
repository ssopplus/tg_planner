'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/telegram/webapp'
import { requestBody } from '@/lib/cockpit/format'

/**
 * Общие куски экранов dev-cockpit в Mini App: список «Сессии» и страница
 * одной сессии. Данные — из снимка, который присылает cockpit с рабочей машины.
 */

export interface SessionTask {
  issue: string | null
  title: string
  status?: { display: string; type: string | null } | null
  todo: { done: boolean; text: string }[]
  log?: { date: string; own: boolean; done?: string; left?: string; blockers?: string } | null
}

export interface Session {
  id: string
  name: string
  project: string
  status: 'waiting' | 'busy' | 'idle'
  lastAssistant?: string
  taskKey?: string | null
  tasks?: SessionTask[]
  permissionMode?: string | null
  updatedAt: string
}

export interface Command {
  id: string
  kind: 'message' | 'start-task'
  sessionId: string | null
  payload: { text?: string; issueKey?: string }
  status: 'pending' | 'sent' | 'done' | 'failed'
  result: { error?: string; output?: string } | null
  createdAt: string
}

export interface Question {
  question: string
  header?: string
  multiSelect?: boolean
  options: { label: string; description?: string }[]
}

export interface Request {
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
  decision: { behavior: 'allow' | 'deny'; always?: boolean; answers?: Record<string, string>; setMode?: string } | null
  createdAt: string
}

export const STATUS = {
  waiting: { label: 'ждёт', dot: 'bg-amber-500' },
  busy: { label: 'работает', dot: 'bg-blue-500' },
  idle: { label: 'простаивает', dot: 'bg-gray-400' },
} as const

/** Цвет статуса задачи в Трекере по его типу (review — тестирование и ревью). */
export const TASK_STATUS: Record<string, string> = {
  inProgress: 'bg-blue-500/15 text-blue-500',
  review: 'bg-purple-500/15 text-purple-500',
  done: 'bg-green-500/15 text-green-600',
  paused: 'bg-amber-500/15 text-amber-600',
}

export const COMMAND_STATUS: Record<Command['status'], string> = {
  pending: 'ждёт cockpit',
  sent: 'cockpit выполняет',
  done: 'доставлено',
  failed: 'не вышло',
}

/** Названия режимов — как в меню VS Code. */
export const MODES: Record<string, string> = {
  default: 'Manual',
  manual: 'Manual',
  acceptEdits: 'Edit automatically',
  plan: 'Plan',
  auto: 'Auto',
  bypassPermissions: 'Bypass',
  dontAsk: "Don't ask",
}
/** На какие режимы можно переключить вместе с ответом (см. SETTABLE_MODES на сервере). */
const SETTABLE = ['default', 'acceptEdits', 'plan', 'auto']
const modeName = (m?: string | null) => (m ? (MODES[m] ?? m) : null)

export const hint = 'text-[var(--tg-theme-hint-color,#8e8e93)]'
export const text = 'text-[var(--tg-theme-text-color,#000)]'
export const card = 'rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)]'
export const chip = 'rounded-full bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-3 py-1.5 text-[12px]'

/** Режим сессии. `quiet` — не показывать обычный Manual (для плотных списков). */
export function ModeChip({ mode, quiet }: { mode?: string | null; quiet?: boolean }) {
  const name = modeName(mode)
  if (!name || (quiet && (mode === 'default' || mode === 'manual'))) return null
  return (
    <span className={`rounded bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-1.5 text-[11px] ${hint}`}>режим: {name}</span>
  )
}

export function TaskBadge({ t, showKey }: { t: SessionTask; showKey: boolean }) {
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
export function TaskDetail({ t }: { t: SessionTask }) {
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

/**
 * Реплика из cockpit для сессии — чужая, «да» в ней подтверждением не считается.
 * Ответ на AskUserQuestion — считается: приходит через хук как ответ пользователя.
 * Этим текстом просим сессию переспросить карточкой.
 */
const ASK_CONFIRM =
  'Если ты ждёшь моего подтверждения или ответа — задай его через AskUserQuestion с вариантами ' +
  '(например «Да, выполняй» / «Нет») и в вопросе коротко назови, что именно сделаешь. Я отвечу в карточке. ' +
  'Если ничего не ждёшь — просто продолжай.'

/** Текст в сессию: уходит через cockpit в её межсессионный сокет. */
export function Composer({ sessionId, commands, onSent }: { sessionId: string; commands: Command[]; onSent: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async (preset?: string) => {
    const message = preset ?? value
    if (!message.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch('/api/cockpit/commands', {
        method: 'POST',
        body: JSON.stringify({ kind: 'message', sessionId, text: message }),
      })
      if (!res.ok) setError(((await res.json()) as { error?: string }).error ?? 'Ошибка')
      else if (!preset) setValue('')
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
          onClick={() => send()}
          className="rounded-lg bg-[var(--tg-theme-button-color,#007aff)] px-3 py-2 text-[13px] text-[var(--tg-theme-button-text-color,#fff)] disabled:opacity-50"
        >
          Отправить
        </button>
        <button type="button" disabled={busy} onClick={() => send(ASK_CONFIRM)} className={`${chip} ${text} disabled:opacity-50`}>
          Спросить кнопками
        </button>
      </div>
      <span className={`text-[11px] leading-snug ${hint}`}>
        Claude получит текст как реплику соседней сессии, и «да» отсюда за подтверждение не примет. Ждёт твоего
        «да» — жми «Спросить кнопками»: сессия задаст вопрос карточкой, ответ в ней засчитается как твой.
      </span>
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

/**
 * Запрос разрешения или вопрос Claude. `mode` — текущий режим сессии: рядом с
 * кнопками можно выбрать, на какой режим переключить её вместе с ответом.
 */
export function RequestCard({ req, mode, onDone }: { req: Request; mode?: string | null; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [setMode, setSetMode] = useState('')
  const questions = req.kind === 'question' ? (req.payload.questions ?? []) : []
  const current = mode === 'manual' ? 'default' : mode

  const submit = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const withMode = setMode && body.behavior !== 'deny' ? { ...body, setMode } : body
      const res = await apiFetch(`/api/cockpit/requests/${req.id}`, { method: 'POST', body: JSON.stringify(withMode) })
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
      <p className={`flex flex-wrap items-center gap-2 text-[14px] font-semibold ${text}`}>
        {req.sessionName}
        <ModeChip mode={mode} />
      </p>

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
      <label className={`flex items-center gap-2 text-[12px] ${hint}`}>
        Режим после ответа
        <select
          value={setMode}
          onChange={(e) => setSetMode(e.target.value)}
          className={`min-w-0 flex-1 rounded-lg border border-border bg-transparent px-2 py-1.5 text-[13px] ${text}`}
        >
          <option value="">не менять{current ? ` (${modeName(current)})` : ''}</option>
          {SETTABLE.filter((m) => m !== current).map((m) => (
            <option key={m} value={m}>
              → {MODES[m]}
            </option>
          ))}
        </select>
      </label>
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
