'use client'

import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Mic, Square, X } from 'lucide-react'
import { apiFetch, webAppConfirm } from '@/lib/telegram/webapp'
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
  waitingFor?: string | null
  background?: boolean
  next?: { key: string; summary: string } | null
  closable?: boolean
  updatedAt: string
}

export interface Command {
  id: string
  kind: 'message' | 'start-task' | 'to-vscode' | 'close-session'
  sessionId: string | null
  payload: { text?: string; issueKey?: string; imageCount?: number }
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

/**
 * «Просмотрено» — как на доске cockpit: сессия, которая что-то сделала после
 * последнего просмотра, попадает в «Готово, посмотреть». Хранится на устройстве.
 */
const SEEN_KEY = 'sessions-seen'
export function readSeen(): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : null
  } catch {
    return {}
  }
}
export function writeSeen(seen: Record<string, number>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen))
  } catch {}
}
export function markSeen(id: string, at: string) {
  const seen = readSeen() ?? {}
  const ts = new Date(at).getTime()
  if ((seen[id] ?? 0) >= ts) return
  writeSeen({ ...seen, [id]: ts })
}

/** Копирование в буфер; во вьюхе Telegram без Clipboard API — через выделение textarea. */
export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.append(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

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

/**
 * План и запись ворклога из заметки start-task. Сразу видно, что осталось:
 * невыполненные пункты открыты, выполненные и ворклог — по нажатию.
 */
export function TaskDetail({ t }: { t: SessionTask }) {
  const [showDone, setShowDone] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const done = t.todo.filter((x) => x.done)
  const left = t.todo.filter((x) => !x.done)
  const pct = t.todo.length ? Math.round((done.length / t.todo.length) * 100) : 0
  const field = (label: string, value?: string) =>
    value ? (
      <div>
        <p className={`text-[11px] font-semibold uppercase ${hint}`}>{label}</p>
        <p className={`whitespace-pre-wrap text-[12.5px] leading-snug ${text}`}>{value}</p>
      </div>
    ) : null
  const item = (x: SessionTask['todo'][number], i: number) => (
    <li key={i} className={`flex gap-1.5 text-[13px] leading-snug ${x.done ? `${hint} line-through` : text}`}>
      <span className={`shrink-0 ${x.done ? 'text-green-600' : ''}`}>{x.done ? '✓' : '○'}</span>
      <span>{x.text}</span>
    </li>
  )
  const toggle = 'w-fit text-[12px] text-[var(--tg-theme-link-color,#007aff)]'

  return (
    <section className="flex flex-col gap-2 rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] p-2.5">
      <p className={`text-[13px] font-semibold ${text}`}>
        {t.issue ? `${t.issue} · ` : ''}
        {t.title}
      </p>

      {t.todo.length ? (
        <>
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10">
              <div className="h-full rounded-full bg-green-600" style={{ width: `${pct}%` }} />
            </div>
            <span className={`text-[11px] tabular-nums ${hint}`}>
              {done.length}/{t.todo.length}
            </span>
          </div>
          {left.length ? (
            <>
              <p className={`text-[11px] font-semibold uppercase ${hint}`}>Осталось · {left.length}</p>
              <ul className="flex flex-col gap-1">{left.map(item)}</ul>
            </>
          ) : (
            <p className="text-[12.5px] text-green-600">Все пункты плана выполнены ✅</p>
          )}
          {done.length ? (
            <>
              <button type="button" onClick={() => setShowDone((v) => !v)} className={toggle}>
                {showDone ? 'Скрыть выполненные' : `Выполнено · ${done.length}`}
              </button>
              {showDone ? <ul className="flex flex-col gap-1">{done.map(item)}</ul> : null}
            </>
          ) : null}
        </>
      ) : (
        <p className={`text-[12px] ${hint}`}>Плана нет — чек-лист «Что нужно сделать» ведёт /start-task.</p>
      )}

      {t.log ? (
        <>
          <button type="button" onClick={() => setShowLog((v) => !v)} className={toggle}>
            {showLog ? 'Скрыть ворклог' : `Ворклог · ${t.log.date}${t.log.own ? ' · эта сессия' : ''}`}
          </button>
          {showLog ? (
            <div className="flex flex-col gap-2">
              {field('Сделано', t.log.done)}
              {field('Осталось', t.log.left)}
              {t.log.blockers && !/^нет\.?$/i.test(t.log.blockers) ? field('Блокеры', t.log.blockers) : null}
            </div>
          ) : null}
          {!showLog && t.log.blockers && !/^нет\.?$/i.test(t.log.blockers) ? (
            <p className="text-[12px] leading-snug text-red-500">Блокеры: {t.log.blockers}</p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

/**
 * «Перенести в VS Code» для фоновой сессии: пока её держит `claude --bg`, расширение
 * VS Code её не откроет. Cockpit останавливает фоновый процесс и открывает сессию
 * во вкладке Claude — переписка сохраняется.
 */
export function MoveToVSCode({ sessionId, commands, onSent }: { sessionId: string; commands: Command[]; onSent: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const last = commands.find((c) => c.kind === 'to-vscode')
  const inFlight = last && (last.status === 'pending' || last.status === 'sent')
  const move = async () => {
    if (!(await webAppConfirm('Остановить фоновую сессию и открыть её в VS Code на Маке? Переписка сохранится.'))) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch('/api/cockpit/commands', { method: 'POST', body: JSON.stringify({ kind: 'to-vscode', sessionId }) })
      if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Ошибка')
      onSent()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <button type="button" disabled={busy || !!inFlight} onClick={move} className={`${chip} ${text} w-fit disabled:opacity-50`}>
        Перенести в VS Code
      </button>
      {last ? (
        <p className={`text-[11px] ${last.status === 'failed' ? 'text-red-500' : hint}`}>
          {last.status === 'done' ? 'Открыто в VS Code на Маке' : COMMAND_STATUS[last.status]}
          {last.result?.error ? `: ${last.result.error}` : ''}
        </p>
      ) : (
        <p className={`text-[11px] leading-snug ${hint}`}>
          Фоновая сессия: в VS Code её можно открыть только так — cockpit остановит фоновый процесс и откроет переписку во
          вкладке Claude.
        </p>
      )}
      {error ? <p className="text-[11px] text-red-500">{error}</p> : null}
    </div>
  )
}

/**
 * Закрыть сессию: cockpit останавливает фоновую (`claude stop`) или завершает
 * процесс вкладки VS Code. Переписка остаётся — её можно продолжить из истории.
 */
export function CloseSession({ sessionId, commands, onSent }: { sessionId: string; commands: Command[]; onSent: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const last = commands.find((c) => c.kind === 'close-session')
  const inFlight = last && (last.status === 'pending' || last.status === 'sent')
  const close = async () => {
    if (!(await webAppConfirm('Закрыть сессию на Маке? Вкладка VS Code покажет отключение, переписка сохранится.'))) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch('/api/cockpit/commands', { method: 'POST', body: JSON.stringify({ kind: 'close-session', sessionId }) })
      if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Ошибка')
      onSent()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <button type="button" disabled={busy || !!inFlight} onClick={close} className={`${chip} ${text} w-fit disabled:opacity-50`}>
        ✕ Закрыть сессию
      </button>
      {last ? (
        <p className={`text-[11px] ${last.status === 'failed' ? 'text-red-500' : hint}`}>
          {last.status === 'done' ? 'Сессия закрыта' : COMMAND_STATUS[last.status]}
          {last.result?.error ? `: ${last.result.error}` : ''}
        </p>
      ) : null}
      {error ? <p className="text-[11px] text-red-500">{error}</p> : null}
    </div>
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

const MAX_IMAGES = 4
/** Длинная сторона скрина после сжатия: текст на нём ещё читается, а весит он сотни КБ, а не мегабайты. */
const IMAGE_SIDE = 2000

/** Сжимает картинку в JPEG data-URL. Тяжёлую пережимаем мельче, чтобы пачка влезла в запрос. */
async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const encode = (side: number, quality: number) => {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Не удалось обработать картинку')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', quality)
  }
  let url = encode(IMAGE_SIDE, 0.85)
  if (url.length > 700_000) url = encode(1600, 0.75)
  bitmap.close()
  return url
}

/** Длинная запись упирается в лимит тела запроса Vercel (4,5 МБ), да и диктовать столько в сессию незачем. */
const VOICE_MAX_SEC = 180

/**
 * Голос в поле ввода: запись в браузере → /api/cockpit/transcribe → текст
 * дописывается в поле. В сессию сразу не уходит — его можно поправить.
 * Где микрофон в вебвью Telegram недоступен, кнопки нет.
 */
function VoiceButton({ disabled, onText, onError }: { disabled: boolean; onText: (t: string) => void; onError: (e: string) => void }) {
  const [state, setState] = useState<'idle' | 'rec' | 'busy'>('idle')
  const [sec, setSec] = useState(0)
  const [supported, setSupported] = useState(false)
  const rec = useRef<MediaRecorder | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setSupported(typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia), 0)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (state !== 'rec') return
    const timer = setInterval(() => setSec((x) => x + 1), 1000)
    return () => clearInterval(timer)
  }, [state])
  useEffect(() => {
    if (state === 'rec' && sec >= VOICE_MAX_SEC) rec.current?.stop()
  }, [state, sec])

  const start = async () => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      onError('Нет доступа к микрофону — разреши его Telegram в настройках телефона')
      return
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m))
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const parts: Blob[] = []
    r.ondataavailable = (e) => e.data.size && parts.push(e.data)
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      setState('busy')
      try {
        const blob = new Blob(parts, { type: (r.mimeType || mime || 'audio/webm').split(';')[0] })
        const res = await apiFetch('/api/cockpit/transcribe', { method: 'POST', body: blob, headers: { 'content-type': blob.type } })
        const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
        if (!res.ok) onError(body.error ?? 'Не удалось распознать')
        else if (body.text) onText(body.text)
        else onError('Ничего не расслышал')
      } finally {
        setState('idle')
      }
    }
    rec.current = r
    setSec(0)
    r.start()
    setState('rec')
  }

  if (!supported) return null
  return (
    <button
      type="button"
      disabled={disabled || state === 'busy'}
      onClick={() => (state === 'rec' ? rec.current?.stop() : start())}
      className={`${chip} flex items-center gap-1 disabled:opacity-50 ${state === 'rec' ? 'text-red-500' : text}`}
    >
      {state === 'rec' ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
      {state === 'rec' ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} · стоп` : state === 'busy' ? 'Распознаю…' : 'Голос'}
    </button>
  )
}

/** Текст, скрины и голос в сессию: уходят через cockpit в её межсессионный сокет. */
export function Composer({ sessionId, commands, onSent }: { sessionId: string; commands: Command[]; onSent: () => void }) {
  const [value, setValue] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return
    setError(null)
    const room = MAX_IMAGES - images.length
    if (files.length > room) setError(`Не больше ${MAX_IMAGES} скринов за раз`)
    try {
      const urls = await Promise.all([...files].slice(0, room).map(compressImage))
      setImages((cur) => [...cur, ...urls].slice(0, MAX_IMAGES))
    } catch {
      setError('Не удалось прочитать картинку')
    }
  }

  const send = async (preset?: string) => {
    const message = preset ?? value
    const shots = preset ? [] : images
    if (!message.trim() && !shots.length) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch('/api/cockpit/commands', {
        method: 'POST',
        body: JSON.stringify({ kind: 'message', sessionId, text: message, ...(shots.length ? { images: shots } : {}) }),
      })
      if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Ошибка')
      else if (!preset) {
        setValue('')
        setImages([])
      }
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
      {images.length ? (
        <div className="flex flex-wrap gap-2">
          {images.map((src, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- data-URL превью, next/image тут ни к чему */}
              <img src={src} alt={`Скрин ${i + 1}`} className="h-16 w-16 rounded-lg border border-border object-cover" />
              <button
                type="button"
                aria-label="Убрать скрин"
                onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-black/70 p-0.5 text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addImages(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || (!value.trim() && !images.length)}
          onClick={() => send()}
          className="rounded-lg bg-[var(--tg-theme-button-color,#007aff)] px-3 py-2 text-[13px] text-[var(--tg-theme-button-text-color,#fff)] disabled:opacity-50"
        >
          Отправить
        </button>
        <button
          type="button"
          disabled={busy || images.length >= MAX_IMAGES}
          onClick={() => fileRef.current?.click()}
          className={`${chip} ${text} flex items-center gap-1 disabled:opacity-50`}
        >
          <ImagePlus className="h-3.5 w-3.5" />
          Скрин
        </button>
        <VoiceButton
          disabled={busy}
          onText={(t) => setValue((cur) => (cur.trim() ? `${cur.trimEnd()} ${t}` : t))}
          onError={setError}
        />
        <button type="button" disabled={busy} onClick={() => send(ASK_CONFIRM)} className={`${chip} ${text} disabled:opacity-50`}>
          Спросить кнопками
        </button>
      </div>
      <span className={`text-[11px] leading-snug ${hint}`}>
        Claude получит текст как реплику соседней сессии, и «да» отсюда за подтверждение не примет. Ждёт твоего
        «да» — жми «Спросить кнопками»: сессия задаст вопрос карточкой, ответ в ней засчитается как твой.
      </span>
      {error ? <p className="text-[12px] text-red-500">{error}</p> : null}
      {commands.filter((c) => c.kind === 'message').slice(0, 3).map((c) => (
        <p key={c.id} className={`truncate text-[11px] ${c.status === 'failed' ? 'text-red-500' : hint}`}>
          {COMMAND_STATUS[c.status]}
          {c.result?.error ? ` (${c.result.error})` : ''}: {c.payload.imageCount ? `📎${c.payload.imageCount} ` : ''}
          {c.payload.text}
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
  const [other, setOther] = useState<Record<string, string>>({})
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

  const toggle = (q: Question, label: string) => {
    setPicked((p) => {
      const cur = p[q.question] ?? []
      const next = q.multiSelect ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label]
      return { ...p, [q.question]: next }
    })
    // Один ответ: выбрал вариант — свой текст больше не нужен.
    if (!q.multiSelect) setOther((o) => ({ ...o, [q.question]: '' }))
  }
  const typeOther = (q: Question, value: string) => {
    setOther((o) => ({ ...o, [q.question]: value }))
    // Один ответ: свой текст заменяет отмеченный вариант.
    if (!q.multiSelect && value.trim()) setPicked((p) => ({ ...p, [q.question]: [] }))
  }
  /** Ответ на вопрос: свой текст заменяет вариант (один ответ) или добавляется к отмеченным (несколько). */
  const answerOf = (q: Question) => {
    const own = (other[q.question] ?? '').trim()
    const ls = picked[q.question] ?? []
    return (q.multiSelect ? [...ls, ...(own ? [own] : [])] : own ? [own] : ls.slice(0, 1)).join(', ')
  }
  const allPicked = questions.every((q) => answerOf(q) !== '')

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
            <input
              value={other[q.question] ?? ''}
              onChange={(e) => typeOther(q, e.target.value)}
              placeholder="Свой вариант"
              className={`rounded-lg border border-border bg-transparent px-2 py-1.5 text-[13px] ${text}`}
            />
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
            onClick={() => submit({ answers: Object.fromEntries(questions.map((q) => [q.question, answerOf(q)])) })}
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
