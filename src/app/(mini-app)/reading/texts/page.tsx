'use client'

import { useMemo, useRef, useState } from 'react'
import { ExternalLink, Trash2 } from 'lucide-react'
import { apiFetch, getInitData, webAppConfirm } from '@/lib/telegram/webapp'
import { showToast } from '@/lib/api/toast'
import { useReading } from '@/components/reading/reading-provider'
import { Btn, Chip, Empty, Lede, Panel, fieldClass } from '@/components/reading/ui'
import { countWords, MIN_CUSTOM_WORDS, validateCustomText } from '@/lib/reading/text-utils'
import type { ReadingLang, ReadingText } from '@/lib/reading/types'

type Source = 'paste' | 'file' | 'url' | 'habr'

const SOURCES: { id: Source; label: string }[] = [
  { id: 'paste', label: 'Вставить' },
  { id: 'file', label: 'Файл' },
  { id: 'url', label: 'Ссылка' },
  { id: 'habr', label: 'Хабр' },
]

interface ImportResponse {
  message?: string
  error?: string
}

/**
 * «Тексты»: откуда взять текст для тренировок и что уже есть. Длинная книга
 * или статья режется на части по 400–800 слов и в списке показывается одной
 * строкой. Файл или ссылку можно прислать и боту в чат.
 */
export default function ReadingTextsPage() {
  const { lang, texts, reloadTexts } = useReading()
  const [source, setSource] = useState<Source>('paste')

  const onImported = async (message: string) => {
    showToast({ kind: 'success', message })
    await reloadTexts()
  }

  return (
    <>
      <Panel title="Добавить текст">
        <div className="flex gap-1.5 overflow-x-auto">
          {SOURCES.map((s) => (
            <Chip key={s.id} active={source === s.id} onClick={() => setSource(s.id)}>
              {s.label}
            </Chip>
          ))}
        </div>
        {source === 'paste' ? <PasteForm onSaved={onImported} /> : null}
        {source === 'file' ? <FileForm onSaved={onImported} /> : null}
        {source === 'url' ? <UrlForm onSaved={onImported} /> : null}
        {source === 'habr' ? <HabrFeed onSaved={onImported} /> : null}
      </Panel>

      <TextList lang={lang} texts={texts} reload={reloadTexts} />
    </>
  )
}

function PasteForm({ onSaved }: { onSaved: (message: string) => Promise<void> }) {
  const { lang } = useReading()
  const [formLang, setFormLang] = useState<ReadingLang>(lang)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const words = countWords(body)

  const save = async () => {
    const checked = validateCustomText({ lang: formLang, title, body })
    if (!checked.ok) {
      setError(checked.error)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch('/api/reading/texts', {
        method: 'POST',
        body: JSON.stringify(checked.value),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ImportResponse
        setError(data.error ?? `Не сохранилось: ошибка ${res.status}`)
        return
      }
      setTitle('')
      setBody('')
      await onSaved('Текст сохранён')
    } catch {
      setError('Нет связи с сервером — текст не сохранён')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Lede>
        Статья или глава книги появится во всех упражнениях. В тесте вместо вопросов — пересказ и
        самооценка, либо вопросы, составленные по тексту.
      </Lede>
      <div className="flex gap-1.5">
        {(['ru', 'en'] as const).map((item) => (
          <Chip key={item} active={formLang === item} onClick={() => setFormLang(item)}>
            {item === 'ru' ? 'Русский' : 'English'}
          </Chip>
        ))}
      </div>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Название"
        className={fieldClass}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Текст. Абзацы разделяйте пустой строкой."
        rows={8}
        className={`${fieldClass} min-h-44 resize-y leading-relaxed`}
      />
      <div className="flex items-center justify-between gap-3">
        <span
          className={`text-[12px] tabular-nums ${
            words >= MIN_CUSTOM_WORDS
              ? 'text-[var(--tg-theme-hint-color,#8e8e93)]'
              : 'text-[var(--color-warning,#ff9500)]'
          }`}
        >
          {words} / {MIN_CUSTOM_WORDS} слов
        </span>
        <Btn variant="primary" onClick={save} disabled={saving}>
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </Btn>
      </div>
      {error ? <p className="text-[13px] text-[var(--destructive,#ff3b30)]">{error}</p> : null}
    </>
  )
}

function FileForm({ onSaved }: { onSaved: (message: string) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upload = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      // Без apiFetch: он ставит Content-Type JSON, а здесь нужна граница multipart от браузера.
      const res = await fetch('/api/reading/import/file', {
        method: 'POST',
        headers: { 'X-Telegram-Init-Data': getInitData() },
        body: form,
      })
      const data = (await res.json().catch(() => ({}))) as ImportResponse
      if (!res.ok) {
        setError(data.error ?? `Не загрузилось: ошибка ${res.status}`)
        return
      }
      await onSaved(data.message ?? 'Файл добавлен')
    } catch {
      setError('Нет связи с сервером')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <>
      <Lede>
        Книга или документ: .fb2, .fb2.zip, .epub, .pdf (с текстовым слоем) или .txt, до 4 МБ. Книга
        разобьётся на части по 400–800 слов. Можно и проще — прислать файл боту в чат.
      </Lede>
      <input
        ref={input}
        type="file"
        accept=".txt,.fb2,.zip,.epub,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) upload(file)
        }}
      />
      <Btn
        variant="primary"
        className="self-start"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Разбираю файл…' : 'Выбрать файл'}
      </Btn>
      {error ? <p className="text-[13px] text-[var(--destructive,#ff3b30)]">{error}</p> : null}
    </>
  )
}

async function importUrl(
  url: string,
  source: 'url' | 'habr',
): Promise<ImportResponse & { ok: boolean }> {
  try {
    const res = await apiFetch('/api/reading/import/url', {
      method: 'POST',
      body: JSON.stringify({ url, source }),
    })
    const data = (await res.json().catch(() => ({}))) as ImportResponse
    return {
      ok: res.ok,
      ...data,
      error: res.ok ? undefined : (data.error ?? `ошибка ${res.status}`),
    }
  } catch {
    return { ok: false, error: 'Нет связи с сервером' }
  }
}

function UrlForm({ onSaved }: { onSaved: (message: string) => Promise<void> }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const result = await importUrl(url, 'url')
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? 'Не загрузилось')
      return
    }
    setUrl('')
    await onSaved(result.message ?? 'Статья добавлена')
  }

  return (
    <>
      <Lede>
        Ссылка на статью — сохранится основной текст страницы, без меню и комментариев. Ссылку можно
        и просто прислать боту.
      </Lede>
      <input
        type="url"
        inputMode="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://…"
        className={fieldClass}
      />
      <Btn variant="primary" className="self-start" disabled={busy || !url.trim()} onClick={submit}>
        {busy ? 'Загружаю…' : 'Добавить'}
      </Btn>
      {error ? <p className="text-[13px] text-[var(--destructive,#ff3b30)]">{error}</p> : null}
    </>
  )
}

interface HabrItem {
  title: string
  url: string
  publishedAt: string
  summary: string
  feed: string
  added: boolean
}

function HabrFeed({ onSaved }: { onSaved: (message: string) => Promise<void> }) {
  const [items, setItems] = useState<HabrItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/reading/habr')
      setItems(res.ok ? ((await res.json()) as HabrItem[]) : [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  const add = async (item: HabrItem) => {
    setBusy(item.url)
    const result = await importUrl(item.url, 'habr')
    setBusy(null)
    if (!result.ok) {
      showToast({ kind: 'error', message: result.error ?? 'Не загрузилось' })
      return
    }
    setItems((list) => list?.map((i) => (i.url === item.url ? { ...i, added: true } : i)) ?? null)
    await onSaved(result.message ?? 'Статья добавлена')
  }

  if (!items) {
    return (
      <>
        <Lede>
          Свежие статьи по вашим темам: разработка, AI, Claude Code. Темы меняются в «Ещё».
        </Lede>
        <Btn variant="primary" className="self-start" disabled={loading} onClick={load}>
          {loading ? 'Загружаю ленту…' : 'Показать статьи'}
        </Btn>
      </>
    )
  }
  if (!items.length)
    return <Empty>Хабр не ответил или по темам ничего нет. Попробуйте позже.</Empty>

  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li
          key={item.url}
          className="flex flex-col gap-1 border-t border-border py-2.5 first:border-t-0"
        >
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 text-[14px] font-medium leading-snug">
              {item.title}
            </span>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              aria-label="Открыть на Хабре"
              className="grid h-7 w-7 shrink-0 place-items-center text-[var(--tg-theme-hint-color,#8e8e93)]"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
          <p className="line-clamp-2 text-[12px] text-[var(--tg-theme-hint-color,#8e8e93)]">
            {item.summary}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--tg-theme-hint-color,#8e8e93)]">
              {item.publishedAt
                ? new Date(item.publishedAt).toLocaleDateString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                  })
                : ''}{' '}
              · {item.feed}
            </span>
            <Btn
              size="sm"
              variant={item.added ? 'secondary' : 'primary'}
              className="ml-auto"
              disabled={item.added || busy === item.url}
              onClick={() => add(item)}
            >
              {item.added ? 'Добавлено' : busy === item.url ? 'Загружаю…' : 'В тексты'}
            </Btn>
          </div>
        </li>
      ))}
    </ul>
  )
}

interface TextRow {
  key: string
  title: string
  level: string | null
  words: number
  parts: number
  /** Текст, по которому удаляется вся строка (для книги — любая её часть с `whole`). */
  deleteId: string | null
  whole: boolean
}

function TextList({
  lang,
  texts,
  reload,
}: {
  lang: ReadingLang
  texts: ReadingText[]
  reload: () => Promise<void>
}) {
  // Части одной книги или статьи — одна строка.
  const rows = useMemo(() => {
    const out: TextRow[] = []
    const groups = new Map<string, TextRow>()
    for (const t of texts) {
      if (t.sourceUrl && (t.parts ?? 1) > 1) {
        const group = groups.get(t.sourceUrl)
        if (group) {
          group.words += t.wordCount
          continue
        }
        const row: TextRow = {
          key: t.sourceUrl,
          title: t.collection ?? t.title,
          level: t.level ?? null,
          words: t.wordCount,
          parts: t.parts ?? 1,
          deleteId: t.id,
          whole: true,
        }
        groups.set(t.sourceUrl, row)
        out.push(row)
        continue
      }
      out.push({
        key: t.id,
        title: t.title,
        level: t.level ?? null,
        words: t.wordCount,
        parts: 1,
        deleteId: t.source === 'builtin' ? null : t.id,
        whole: false,
      })
    }
    return out
  }, [texts])

  const remove = async (row: TextRow) => {
    if (!row.deleteId) return
    const what = row.parts > 1 ? `все ${row.parts} частей «${row.title}»` : `текст «${row.title}»`
    if (!(await webAppConfirm(`Удалить ${what}?`))) return
    const res = await apiFetch(`/api/reading/texts/${row.deleteId}${row.whole ? '?whole=1' : ''}`, {
      method: 'DELETE',
    }).catch(() => null)
    if (!res?.ok) {
      showToast({ kind: 'error', message: 'Не удалось удалить' })
      return
    }
    await reload()
  }

  return (
    <Panel title={`Тексты · ${lang === 'ru' ? 'русский' : 'английский'}`} aside={rows.length}>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex min-w-0 items-center gap-2 border-t border-border py-2.5 first:border-t-0"
          >
            {row.level ? (
              <span className="shrink-0 rounded bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-1.5 py-0.5 font-mono text-[11px] font-semibold">
                {row.level}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-[14px]">{row.title}</span>
            <span className="shrink-0 text-right text-[12px] tabular-nums text-[var(--tg-theme-hint-color,#8e8e93)]">
              {row.parts > 1 ? `${row.parts} ч. · ` : ''}
              {row.words} сл.
            </span>
            {row.deleteId ? (
              <button
                type="button"
                onClick={() => remove(row)}
                aria-label={`Удалить «${row.title}»`}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--tg-theme-hint-color,#8e8e93)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : (
              <span className="w-8 shrink-0" aria-hidden />
            )}
          </li>
        ))}
      </ul>
    </Panel>
  )
}
