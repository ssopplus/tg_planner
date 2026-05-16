'use client'

import { useState, useCallback, KeyboardEvent } from 'react'
import { Plus } from 'lucide-react'
import { mutateSafely } from '@/lib/api/mutate'
import { showToast } from '@/lib/api/toast'

interface QuickCaptureBarProps {
  /** ID проекта для создаваемой задачи. Если не задан — попадёт в дефолтный. */
  projectId?: string | null
  /** Дополнительные поля при создании: myDayDate для /today и т.п. */
  extraFields?: Record<string, unknown>
  /** Колбэк после успешного создания (рефреш списка). */
  onCreated?: () => void
  /** Placeholder инпута. */
  placeholder?: string
}

/**
 * Sticky-инпут поверх списка задач: один Enter — задача создана.
 * Никаких bottom-sheet, никаких диалогов.
 */
export function QuickCaptureBar({
  projectId,
  extraFields,
  onCreated,
  placeholder = 'Добавить задачу…',
}: QuickCaptureBarProps) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = useCallback(async () => {
    const value = title.trim()
    if (!value || busy) return
    setBusy(true)
    setTitle('')
    const ok = await mutateSafely({
      method: 'POST',
      url: '/api/tasks',
      body: {
        title: value,
        ...(projectId && { projectId }),
        ...extraFields,
      },
      label: 'Создание задачи',
      onRollback: () => setTitle(value),
    })
    if (ok) {
      showToast({ kind: 'success', message: 'Задача создана', duration: 1200 })
      onCreated?.()
    }
    setBusy(false)
  }, [title, busy, projectId, extraFields, onCreated])

  const onKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void submit()
      }
    },
    [submit],
  )

  return (
    <div className="sticky top-0 z-30 bg-[var(--tg-theme-bg-color,#f2f2f7)] px-4 pt-2 pb-2">
      <div className="flex items-center gap-2 rounded-xl bg-[var(--tg-theme-section-bg-color,#fff)] px-3 py-2 shadow-sm">
        <Plus className="h-4 w-4 text-[var(--tg-theme-hint-color,#8e8e93)] flex-shrink-0" />
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--tg-theme-text-color,#000)] placeholder:text-[var(--tg-theme-hint-color,#8e8e93)] outline-none"
        />
        {title.trim() && (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="flex-shrink-0 h-7 px-2.5 rounded-lg bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)] text-xs font-medium active:scale-95 transition-transform disabled:opacity-40"
          >
            Enter
          </button>
        )}
      </div>
    </div>
  )
}
