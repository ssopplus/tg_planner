'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { apiFetch, webAppConfirm } from '@/lib/telegram/webapp'
import { showToast } from '@/lib/api/toast'
import { countWords, MIN_CUSTOM_WORDS, validateCustomText } from '@/lib/reading/text-utils'
import type { ReadingLang } from '@/lib/reading/types'
import { useReading } from '@/components/reading/reading-provider'

const fieldClass =
  'w-full rounded-lg border border-border bg-[var(--tg-theme-bg-color,#f2f2f7)] px-3 py-2 text-[14px] text-[var(--tg-theme-text-color,#000)] placeholder:text-[var(--tg-theme-hint-color,#8e8e93)]'

/**
 * «Тексты»: добавить свой текст и посмотреть, что есть на языке тренировок.
 * Пока только вставка из буфера; файлы, ссылки, бот и Хабр — следующие этапы.
 */
export default function ReadingTextsPage() {
  const { lang, texts, reloadTexts } = useReading()
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
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? `Не сохранилось: ошибка ${res.status}`)
        return
      }
      setTitle('')
      setBody('')
      showToast({ kind: 'success', message: 'Текст сохранён' })
      await reloadTexts()
    } catch {
      setError('Нет связи с сервером — текст не сохранён')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string, textTitle: string) => {
    if (!(await webAppConfirm(`Удалить текст «${textTitle}»?`))) return
    const res = await apiFetch(`/api/reading/texts/${id}`, { method: 'DELETE' }).catch(() => null)
    if (!res?.ok) {
      showToast({ kind: 'error', message: 'Не удалось удалить текст' })
      return
    }
    await reloadTexts()
  }

  return (
    <>
      <section className="mx-4 flex flex-col gap-3 rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-4">
        <h2 className="text-[16px] font-semibold text-[var(--tg-theme-text-color,#000)]">
          Добавить свой текст
        </h2>
        <p className="text-[13px] leading-snug text-[var(--tg-theme-hint-color,#8e8e93)]">
          Статья или глава книги появится во всех упражнениях. В тесте вместо вопросов вы
          перескажете суть и сами оцените понимание.
        </p>

        <div className="flex gap-1.5">
          {(['ru', 'en'] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={formLang === item}
              onClick={() => setFormLang(item)}
              className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${
                formLang === item
                  ? 'bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)]'
                  : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-hint-color,#8e8e93)]'
              }`}
            >
              {item === 'ru' ? 'Русский' : 'English'}
            </button>
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
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-[var(--tg-theme-button-color,#007aff)] px-4 py-2 text-[14px] font-medium text-[var(--tg-theme-button-text-color,#fff)] disabled:opacity-50"
          >
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>
        {error ? <p className="text-[13px] text-[var(--destructive,#ff3b30)]">{error}</p> : null}
      </section>

      <section className="mx-4 flex flex-col rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)] px-4 py-2">
        <h2 className="py-2 text-[16px] font-semibold text-[var(--tg-theme-text-color,#000)]">
          Тексты · {lang === 'ru' ? 'русский' : 'английский'}
        </h2>
        <ul className="flex flex-col">
          {texts.map((text) => (
            <li
              key={text.id}
              className="flex min-w-0 items-center gap-2 border-t border-border py-2.5"
            >
              {text.level ? (
                <span className="shrink-0 rounded bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[var(--tg-theme-text-color,#000)]">
                  {text.level}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--tg-theme-text-color,#000)]">
                {text.title}
              </span>
              <span className="shrink-0 text-[12px] tabular-nums text-[var(--tg-theme-hint-color,#8e8e93)]">
                {text.wordCount} сл.
              </span>
              {text.source === 'builtin' ? (
                <span className="w-8 shrink-0" aria-hidden />
              ) : (
                <button
                  type="button"
                  onClick={() => remove(text.id, text.title)}
                  aria-label={`Удалить «${text.title}»`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--tg-theme-hint-color,#8e8e93)]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
