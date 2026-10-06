'use client'

import { useState } from 'react'
import { apiFetch, hapticImpact } from '@/lib/telegram/webapp'
import { showToast } from '@/lib/api/toast'

const MINUTE_PRESETS = [15, 30, 60, 120, 240]
const COMMENT_PRESETS = ['Разработка', 'Обсуждение задачи', 'Правки', 'Дейли', 'Новый функционал']

/**
 * Списание времени из карточки задачи.
 *
 * Два тапа: длительность и комментарий. Комментарий выбран заранее, потому
 * что в Трекере он обязателен по договорённости команды, а набирать его с
 * телефона каждый раз — главная причина, по которой часы не списывают вовремя.
 */
export function WorklogPanel({
  issueKey,
  issueTitle,
  spentLabel,
  onLogged,
}: {
  issueKey: string
  issueTitle: string
  spentLabel: string
  onLogged: () => void
}) {
  const [comment, setComment] = useState(COMMENT_PRESETS[0])
  const [customOpen, setCustomOpen] = useState(false)
  const [customMinutes, setCustomMinutes] = useState('')
  const [saving, setSaving] = useState(false)

  async function log(minutes: number) {
    if (saving || minutes <= 0) return
    setSaving(true)
    hapticImpact('medium')

    const res = await apiFetch('/api/worklog', {
      method: 'POST',
      body: JSON.stringify({ issueKey, issueTitle, minutes, comment }),
    })

    if (res.ok) {
      showToast({ kind: 'success', message: `Списано ${formatMinutes(minutes)}` })
      setCustomOpen(false)
      setCustomMinutes('')
      onLogged()
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      showToast({ kind: 'error', message: data.error ?? 'Трекер не принял списание' })
    }
    setSaving(false)
  }

  return (
    <section className="rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-[var(--tg-theme-text-color,#000)]">
          Списать время
        </h2>
        <span className="text-[11px] text-[var(--tg-theme-hint-color,#8e8e93)]">{spentLabel}</span>
      </div>

      <div className="mt-2 flex gap-1.5">
        {MINUTE_PRESETS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            disabled={saving}
            onClick={() => log(minutes)}
            className="flex-1 rounded-lg border border-border bg-[var(--tg-theme-secondary-bg-color,#efeff4)] py-2 text-[13px] font-semibold tabular-nums text-[var(--tg-theme-text-color,#000)] active:opacity-60 disabled:opacity-40"
          >
            {formatMinutes(minutes)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v)}
          aria-label="Другая длительность"
          className="rounded-lg border border-border bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-3 py-2 text-[13px] font-semibold text-[var(--tg-theme-text-color,#000)] active:opacity-60"
        >
          …
        </button>
      </div>

      {customOpen ? (
        <div className="mt-2 flex gap-2">
          <input
            id={`worklog-custom-${issueKey}`}
            inputMode="numeric"
            placeholder="Минут"
            value={customMinutes}
            onChange={(e) => setCustomMinutes(e.target.value.replace(/\D/g, ''))}
            className="min-w-0 flex-1 rounded-lg border border-border bg-[var(--tg-theme-bg-color,#fff)] px-3 py-2 text-[15px] text-[var(--tg-theme-text-color,#000)]"
          />
          <button
            type="button"
            disabled={saving || !customMinutes}
            onClick={() => log(Number(customMinutes))}
            className="rounded-lg bg-[var(--tg-theme-button-color,#007aff)] px-4 py-2 text-[14px] font-semibold text-[var(--tg-theme-button-text-color,#fff)] disabled:opacity-40"
          >
            Списать
          </button>
        </div>
      ) : null}

      <div className="mt-2 flex gap-1.5 overflow-x-auto touch-pan-x pb-0.5">
        {COMMENT_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setComment(preset)}
            className={`shrink-0 rounded-full px-3 py-1 text-[12px] transition-colors ${
              comment === preset
                ? 'bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)]'
                : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-hint-color,#8e8e93)]'
            }`}
          >
            {preset}
          </button>
        ))}
      </div>

      <input
        id={`worklog-comment-${issueKey}`}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Комментарий к списанию"
        className="mt-2 w-full rounded-lg border border-border bg-[var(--tg-theme-bg-color,#fff)] px-3 py-2 text-[14px] text-[var(--tg-theme-text-color,#000)]"
      />
    </section>
  )
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}м`
  if (!m) return `${h}ч`
  return `${h}ч ${m}м`
}
