'use client'

import { useEffect, useState } from 'react'
import { Volume2, X } from 'lucide-react'
import { apiFetch } from '@/lib/telegram/webapp'
import { glossLookup } from '@/lib/reading/glossary'
import { useReading } from './reading-provider'
import { speakEnglish } from './speak'
import { Btn, fieldClass } from './ui'

export interface WordQuery {
  surface: string
  sentence: string
  glossary: Record<string, string> | null | undefined
}

type Lookup =
  | { state: 'loading' }
  | { state: 'found'; base: string; ru: string; source: string }
  | { state: 'missing'; reason: string }

const SOURCE_LABEL: Record<string, string> = {
  glossary: 'словарь текста',
  cache: 'сохранённый перевод',
  ai: 'перевод AI',
}

/**
 * Карточка слова снизу экрана: словарная форма, перевод в контексте, откуда
 * перевод, кнопка «В карточки». Снизу, а не у слова — на телефоне всплывашка
 * у слова закрывает строку, которую читаешь.
 */
export function WordSheet({
  query,
  saved,
  onClose,
  onAdded,
}: {
  query: WordQuery
  saved: Set<string>
  onClose: () => void
  onAdded: () => void
}) {
  const { addCard } = useReading()
  const [lookup, setLookup] = useState<Lookup>(() => {
    const hit = glossLookup(query.surface, query.glossary)
    return hit ? { state: 'found', ...hit, source: 'glossary' } : { state: 'loading' }
  })
  const [manual, setManual] = useState('')
  const [added, setAdded] = useState(false)

  useEffect(() => {
    if (lookup.state !== 'loading') return
    let cancelled = false
    apiFetch('/api/reading/translate', {
      method: 'POST',
      body: JSON.stringify({ word: query.surface, sentence: query.sentence }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          base?: string
          ru?: string
          source?: string
          error?: string
        }
        if (cancelled) return
        if (res.ok && data.ru) {
          setLookup({
            state: 'found',
            base: data.base ?? query.surface,
            ru: data.ru,
            source: data.source ?? 'ai',
          })
        } else {
          setLookup({ state: 'missing', reason: data.error ?? 'Перевод недоступен' })
        }
      })
      .catch(() => {
        if (!cancelled) setLookup({ state: 'missing', reason: 'Нет связи' })
      })
    return () => {
      cancelled = true
    }
  }, [lookup.state, query.surface, query.sentence])

  const base = lookup.state === 'found' ? lookup.base : query.surface
  const already = saved.has(query.surface) || saved.has(base)

  const add = async () => {
    const ru = lookup.state === 'found' ? lookup.ru : manual.trim()
    if (!ru) return
    if (await addCard({ en: base, ru, ctx: query.sentence, surface: query.surface })) {
      setAdded(true)
      onAdded()
    }
  }

  return (
    <div
      role="dialog"
      aria-label={`Слово ${base}`}
      className="fixed inset-x-0 bottom-20 z-50 mx-auto flex w-[min(100%-32px,480px)] flex-col gap-2 rounded-2xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-4 shadow-xl"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-[family-name:var(--font-reading)] text-[22px] font-semibold">
          {base}
        </span>
        <button
          type="button"
          aria-label="Произнести"
          onClick={() => speakEnglish(base)}
          className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)]"
        >
          <Volume2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Закрыть"
          onClick={onClose}
          className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {lookup.state === 'loading' ? (
        <p className="text-[15px] text-[var(--tg-theme-hint-color,#8e8e93)]">Перевожу…</p>
      ) : lookup.state === 'found' ? (
        <>
          <p className="text-[16px]">{lookup.ru}</p>
          <p className="text-[11px] uppercase tracking-wide text-[var(--tg-theme-hint-color,#8e8e93)]">
            {SOURCE_LABEL[lookup.source] ?? lookup.source}
          </p>
        </>
      ) : (
        <>
          <p className="text-[13px] text-[var(--tg-theme-hint-color,#8e8e93)]">
            {lookup.reason}. Можно ввести свой перевод.
          </p>
          <input
            type="text"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Перевод"
            className={fieldClass}
          />
        </>
      )}

      <p className="line-clamp-3 font-[family-name:var(--font-reading)] text-[13px] text-[var(--tg-theme-hint-color,#8e8e93)]">
        {query.sentence}
      </p>

      <Btn
        variant="primary"
        size="sm"
        className="self-start"
        disabled={
          already ||
          added ||
          lookup.state === 'loading' ||
          (lookup.state === 'missing' && !manual.trim())
        }
        onClick={add}
      >
        {added ? 'Добавлено' : already ? 'Уже в карточках' : 'В карточки'}
      </Btn>
    </div>
  )
}
