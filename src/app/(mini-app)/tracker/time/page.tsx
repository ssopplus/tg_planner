'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { apiFetch, hapticImpact } from '@/lib/telegram/webapp'
import { showToast } from '@/lib/api/toast'

interface WorklogRow {
  id: string
  issueKey: string
  issueTitle: string | null
  minutes: number
  comment: string | null
}

interface DayData {
  day: string
  rows: WorklogRow[]
  total: number
  totalLabel: string
  remainingLabel: string
}

/** Цвета полосы дня — по очередям, в порядке убывания времени. */
const BAR_COLORS = ['#1f6feb', '#0f7a52', '#9a5b00', '#7c3aed', '#b42318']

export default function TimePage() {
  const router = useRouter()
  const [day, setDay] = useState<string>(() => new Date().toLocaleDateString('en-CA'))
  const [data, setData] = useState<DayData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (date: string) => {
    try {
      const res = await apiFetch(`/api/worklog?date=${date}`)
      if (res.ok) {
        setData((await res.json()) as DayData)
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        showToast({ kind: 'error', message: err.error ?? 'Трекер не ответил' })
        setData(null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(day)
  }, [day, load])

  // Разбивка по очередям: ключ задачи до дефиса. Так видно, куда ушёл день,
  // без разбора каждой строки по отдельности.
  const byQueue = useMemo(() => {
    if (!data) return []
    const totals: Record<string, number> = {}
    for (const row of data.rows) {
      const queue = row.issueKey.split('-')[0]
      totals[queue] = (totals[queue] ?? 0) + row.minutes
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1])
  }, [data])

  async function remove(row: WorklogRow) {
    hapticImpact('rigid')
    const res = await apiFetch(`/api/worklog/${row.id}`, { method: 'DELETE' })
    if (res.ok) {
      showToast({ kind: 'success', message: 'Списание удалено' })
      load(day)
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      showToast({ kind: 'error', message: err.error ?? 'Не удалось удалить' })
    }
  }

  async function edit(row: WorklogRow, minutes: number) {
    const res = await apiFetch(`/api/worklog/${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ minutes }),
    })
    if (res.ok) {
      load(day)
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      showToast({ kind: 'error', message: err.error ?? 'Не удалось изменить' })
    }
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-3">
      <button
        type="button"
        onClick={() => router.back()}
        className="flex w-fit items-center gap-1 text-[14px] text-[var(--tg-theme-link-color,#007aff)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Назад
      </button>

      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-[var(--tg-theme-text-color,#000)]">Время</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDay(shiftDay(day, -1))}
            aria-label="Предыдущий день"
            className="rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] p-1.5"
          >
            <ChevronLeft className="h-4 w-4 text-[var(--tg-theme-text-color,#000)]" />
          </button>
          <span className="min-w-[88px] text-center text-[13px] text-[var(--tg-theme-hint-color,#8e8e93)]">
            {formatDay(day)}
          </span>
          <button
            type="button"
            onClick={() => setDay(shiftDay(day, 1))}
            aria-label="Следующий день"
            className="rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] p-1.5"
          >
            <ChevronRight className="h-4 w-4 text-[var(--tg-theme-text-color,#000)]" />
          </button>
        </div>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">
          Считаю день…
        </p>
      ) : !data || data.rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-4 text-center">
          <p className="text-[15px] font-semibold text-[var(--tg-theme-text-color,#000)]">
            За этот день ничего не списано
          </p>
          <p className="mt-1 text-[13px] text-[var(--tg-theme-hint-color,#8e8e93)]">
            Списать время можно из карточки задачи в разделе «Трекер».
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[22px] font-bold tabular-nums text-[var(--tg-theme-text-color,#000)]">
                {data.totalLabel}
              </span>
              <span className="text-[12px] text-[var(--tg-theme-hint-color,#8e8e93)]">
                до нормы {data.remainingLabel}
              </span>
            </div>

            <div className="mt-2 flex h-[7px] overflow-hidden rounded-full bg-[var(--tg-theme-secondary-bg-color,#efeff4)]">
              {byQueue.map(([queue, minutes], i) => (
                <span
                  key={queue}
                  style={{
                    width: `${(minutes / (8 * 60)) * 100}%`,
                    background: BAR_COLORS[i % BAR_COLORS.length],
                  }}
                />
              ))}
            </div>

            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--tg-theme-hint-color,#8e8e93)]">
              {byQueue.map(([queue, minutes], i) => (
                <span key={queue} className="flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ background: BAR_COLORS[i % BAR_COLORS.length] }}
                  />
                  {queue} {formatMinutes(minutes)}
                </span>
              ))}
            </div>
          </section>

          <div className="flex flex-col gap-2">
            {data.rows.map((row) => (
              <WorklogLine key={row.id} row={row} onEdit={edit} onRemove={remove} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function WorklogLine({
  row,
  onEdit,
  onRemove,
}: {
  row: WorklogRow
  onEdit: (row: WorklogRow, minutes: number) => void
  onRemove: (row: WorklogRow) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="font-mono text-[12px] font-medium text-[var(--tg-theme-link-color,#007aff)]">
          {row.issueKey}
        </span>
        <span className="font-mono text-[13px] tabular-nums text-[var(--tg-theme-text-color,#000)]">
          {formatMinutes(row.minutes)}
        </span>
      </button>

      {row.comment ? (
        <p className="mt-0.5 text-[12px] text-[var(--tg-theme-hint-color,#8e8e93)]">{row.comment}</p>
      ) : null}

      {open ? (
        <div className="mt-2 flex items-center gap-1.5">
          {[15, 30, 60, 120].map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => onEdit(row, minutes)}
              className={`flex-1 rounded-lg py-1.5 text-[12px] font-semibold tabular-nums ${
                row.minutes === minutes
                  ? 'bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)]'
                  : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-text-color,#000)]'
              }`}
            >
              {formatMinutes(minutes)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onRemove(row)}
            aria-label="Удалить списание"
            className="rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] p-2 text-[var(--tg-theme-destructive-text-color,#d1453b)]"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** Сдвиг дня без таймзонной арифметики: строка YYYY-MM-DD → соседний день. */
function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() + delta)
  return date.toLocaleDateString('en-CA')
}

function formatDay(day: string): string {
  const today = new Date().toLocaleDateString('en-CA')
  if (day === today) return 'сегодня'
  if (day === shiftDay(today, -1)) return 'вчера'
  return new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  })
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}м`
  if (!m) return `${h}ч`
  return `${h}ч ${m}м`
}
