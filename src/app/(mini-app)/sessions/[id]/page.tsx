'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { apiFetch } from '@/lib/telegram/webapp'
import {
  Composer,
  copyText,
  hint,
  markSeen,
  ModeChip,
  MoveToVSCode,
  RequestCard,
  STATUS,
  TaskBadge,
  TaskDetail,
  text,
  type Command,
  type Request,
  type Session,
} from '@/components/cockpit/session-parts'
import type { CockpitChatItem } from '@/lib/db/schema'

interface SessionData {
  session: Session | null
  syncedAt: string | null
  items: CockpitChatItem[]
  transcriptAt: string | null
  requests: Request[]
  commands: Command[]
}

/** Опрос, пока экран открыт: он же держит отметку «смотрят», по которой cockpit шлёт переписку. */
const POLL_MS = 3000

/** Markdown-ответы Claude: базовые стили без typography-плагина. */
const MD =
  'text-[14px] leading-relaxed break-words [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 ' +
  '[&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:mt-3 [&_h1]:text-[16px] [&_h1]:font-bold [&_h2]:mt-3 ' +
  '[&_h2]:text-[15px] [&_h2]:font-bold [&_h3]:mt-2 [&_h3]:font-semibold [&_strong]:font-semibold ' +
  '[&_a]:text-[var(--tg-theme-link-color,#007aff)] [&_a]:underline [&_code]:rounded [&_code]:bg-black/5 ' +
  '[&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg ' +
  '[&_pre]:bg-black/5 [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-2 [&_table]:text-[12px] ' +
  '[&_td]:border [&_td]:border-border [&_td]:px-1.5 [&_th]:border [&_th]:border-border [&_th]:px-1.5 ' +
  '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2'

type Block = { kind: 'msg'; item: CockpitChatItem } | { kind: 'tools'; items: Extract<CockpitChatItem, { kind: 'tool' }>[] }

/** Подряд идущие действия Claude сворачиваются в одну строку «🔧 N действий». */
function toBlocks(items: CockpitChatItem[]): Block[] {
  const out: Block[] = []
  for (const it of items) {
    const last = out.at(-1)
    if (it.kind === 'tool') {
      if (last?.kind === 'tools') last.items.push(it)
      else out.push({ kind: 'tools', items: [it] })
    } else out.push({ kind: 'msg', item: it })
  }
  return out
}

const hhmm = (ts: number | null) =>
  ts ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''

/**
 * Переписка одной сессии Claude Code. Пока экран открыт, dev-cockpit
 * присылает её хвост (последние ~100 сообщений) с рабочей машины; действия
 * Claude видны одной строкой, без входа и вывода. Закрыл экран — через минуту
 * cockpit перестаёт слать, через час копия удаляется.
 */
export default function SessionPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [data, setData] = useState<SessionData | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const bottomRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const lastCount = useRef(0)

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/cockpit/sessions/${id}`)
    if (res.ok) setData((await res.json()) as SessionData)
    setNow(Date.now())
  }, [id])

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') load()
    }
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, POLL_MS)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [load])

  // Держимся низа, пока пользователь сам не прокрутил вверх.
  useEffect(() => {
    const onScroll = () => {
      stickRef.current = window.innerHeight + window.scrollY >= document.body.scrollHeight - 120
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    const count = data?.items.length ?? 0
    if (count !== lastCount.current && stickRef.current) bottomRef.current?.scrollIntoView({ block: 'end' })
    lastCount.current = count
  }, [data?.items.length])

  const s = data?.session
  const st = s ? (STATUS[s.status] ?? STATUS.idle) : null

  // Открыл переписку — сессия просмотрена и уходит из «Готово, посмотреть» на доске.
  useEffect(() => {
    if (s?.updatedAt) markSeen(s.id, s.updatedAt)
  }, [s?.id, s?.updatedAt])
  const transcriptAgo = data?.transcriptAt ? Math.round((now - new Date(data.transcriptAt).getTime()) / 1000) : null

  return (
    <div className="flex flex-col gap-3 px-4 pt-3">
      <button
        type="button"
        onClick={() => router.back()}
        className="flex w-fit items-center gap-1 text-[14px] text-[var(--tg-theme-link-color,#007aff)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Сессии
      </button>

      <div className="flex flex-col gap-1">
        <h1 className={`text-[18px] font-bold leading-snug ${text}`}>{s?.name ?? 'Сессия'}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {st ? (
            <span className={`flex items-center gap-1.5 text-[12px] ${hint}`}>
              <span className={`h-2 w-2 rounded-full ${st.dot}`} />
              {st.label}
            </span>
          ) : null}
          {s?.project ? <span className={`text-[12px] ${hint}`}>{s.project}</span> : null}
          <ModeChip mode={s?.permissionMode} />
          {(s?.tasks ?? []).map((t) => (
            <TaskBadge key={t.issue ?? t.title} t={t} showKey />
          ))}
        </div>
      </div>

      {s?.background ? <MoveToVSCode sessionId={id} commands={data?.commands ?? []} onSent={load} /> : null}

      {s?.waitingFor ? (
        <p className="rounded-xl border border-amber-400 p-2.5 text-[13px] leading-snug text-amber-600">⏳ Ждёт {s.waitingFor}</p>
      ) : null}

      {s?.tasks?.map((t) => <TaskDetail key={t.issue ?? t.title} t={t} />)}

      {data?.requests.map((r) => (
        <RequestCard key={r.id} req={r} mode={s?.permissionMode} onDone={load} />
      ))}

      <div className="flex flex-col gap-2.5">
        {!data ? (
          <p className={`py-6 text-center text-sm ${hint}`}>Загружаю…</p>
        ) : !data.transcriptAt ? (
          <p className={`py-6 text-center text-sm ${hint}`}>
            Запрашиваю переписку у dev-cockpit на рабочей машине — обычно до 15 секунд.
          </p>
        ) : data.items.length === 0 ? (
          <p className={`py-6 text-center text-sm ${hint}`}>В переписке пока пусто</p>
        ) : (
          toBlocks(data.items).map((b, i) => <ChatBlock key={i} b={b} />)
        )}
      </div>

      {transcriptAgo !== null ? (
        <p className={`text-center text-[11px] ${hint}`}>
          переписка с машины {transcriptAgo < 5 ? 'только что' : `${transcriptAgo} с назад`} · последние ~100 сообщений
        </p>
      ) : null}

      <Composer sessionId={id} commands={data?.commands ?? []} onSent={load} />
      <div ref={bottomRef} />
    </div>
  )
}

function ChatBlock({ b }: { b: Block }) {
  if (b.kind === 'tools') {
    const errors = b.items.filter((t) => t.isError).length
    return (
      <details className={`rounded-lg px-2 py-1 text-[12px] ${hint}`}>
        <summary>
          🔧 {b.items.length === 1 ? b.items[0].name : `${b.items.length} действий`}
          {errors ? <span className="text-red-500"> · ошибок {errors}</span> : null}
        </summary>
        <ul className="mt-1 flex flex-col gap-0.5 pl-4">
          {b.items.map((t, i) => (
            <li key={i} className={`truncate font-mono text-[11px] ${t.isError ? 'text-red-500' : ''}`}>
              {t.name} {t.summary}
            </li>
          ))}
        </ul>
      </details>
    )
  }
  const it = b.item
  if (it.kind === 'user') {
    return (
      <div className="ml-6 flex flex-col items-end gap-0.5">
        <span className={`text-[11px] ${hint}`}>
          {it.via === 'cockpit' ? 'Вы · из cockpit' : it.via === 'peer' ? 'Соседняя сессия' : 'Вы'} · {hhmm(it.ts)}
        </span>
        <div
          className={`max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-[var(--tg-theme-button-color,#007aff)]/15 px-3 py-2 text-[14px] ${text}`}
        >
          {it.text}
        </div>
      </div>
    )
  }
  if (it.kind !== 'assistant') return null
  return <AssistantMessage text={it.text} ts={it.ts} />
}

/** Кнопка копирования: подпись меняется на секунду, чтобы было видно, что сработало. */
function CopyButton({ get, className }: { get: () => string; className: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      data-copy-btn
      onClick={async () => {
        await copyText(get())
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      className={className}
    >
      {done ? 'Скопировано' : 'Копировать'}
    </button>
  )
}

/**
 * Блок ``` с кнопкой «Копировать» и переносом строк. Блок без языка (или text)
 * — обычно текст «вставить как есть»: обычным шрифтом, а не моноширинным.
 */
function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const child = Array.isArray(children) ? children[0] : children
  const lang = /language-(\S+)/.exec(
    ((child as { props?: { className?: string } } | null)?.props?.className as string | undefined) ?? '',
  )?.[1]
  const plain = !lang || /^(text|txt|plain|plaintext|markdown|md)$/i.test(lang)
  return (
    <div className="relative my-2">
      <pre
        ref={ref}
        className={`!my-0 !overflow-visible whitespace-pre-wrap break-words pr-24 ${plain ? '[&_code]:!font-sans [&_code]:!text-[14px] [&_code]:!leading-relaxed' : ''}`}
      >
        {children}
      </pre>
      <CopyButton
        get={() => ref.current?.innerText.trim() ?? ''}
        className="absolute right-1.5 top-1.5 rounded-md bg-[var(--tg-theme-section-bg-color,#fff)] px-2 py-0.5 text-[11.5px] text-[var(--tg-theme-link-color,#007aff)] shadow-sm"
      />
    </div>
  )
}

function AssistantMessage({ text: body, ts }: { text: string; ts: number | null }) {
  const ref = useRef<HTMLDivElement>(null)
  // Текст сообщения без подписей кнопок: на время чтения прячем их (innerText пропускает display:none).
  const plainText = () => {
    const el = ref.current
    if (!el) return body
    const btns = [...el.querySelectorAll<HTMLElement>('[data-copy-btn]')]
    btns.forEach((b) => (b.style.display = 'none'))
    const value = el.innerText.trim()
    btns.forEach((b) => (b.style.display = ''))
    return value
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`flex items-center gap-2 text-[11px] ${hint}`}>
        Claude · {hhmm(ts)}
        <CopyButton get={plainText} className="text-[11px] text-[var(--tg-theme-link-color,#007aff)]" />
      </span>
      <div ref={ref} className={`${MD} ${text}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
            table: ({ children }) => (
              <div className="overflow-x-auto">
                <table>{children}</table>
              </div>
            ),
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
          }}
        >
          {body}
        </ReactMarkdown>
      </div>
    </div>
  )
}
