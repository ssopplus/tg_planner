'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { apiFetch, hapticImpact } from '@/lib/telegram/webapp'
import { showToast } from '@/lib/api/toast'

interface Transition {
  id: string
  display: string
  to: string
}

/**
 * Смена статуса задачи в Трекере.
 *
 * Переходы не зашиты в приложение: у каждой очереди свой набор, и он зависит
 * от текущего статуса. Список запрашивается при открытии списка, а после
 * выполнения перехода приходит обновлённый — следующий шаг может быть другим
 * (в POLAERP «В работу» идёт через «По плану» двумя переходами).
 */
export function StatusSwitcher({
  issueKey,
  statusLabel,
  onChanged,
}: {
  issueKey: string
  statusLabel: string
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [transitions, setTransitions] = useState<Transition[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  async function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (transitions.length > 0) return

    setLoading(true)
    const res = await apiFetch(`/api/tracker/issues/${issueKey}/transitions`)
    if (res.ok) {
      setTransitions((await res.json()) as Transition[])
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      showToast({ kind: 'error', message: data.error ?? 'Не удалось получить статусы' })
      setOpen(false)
    }
    setLoading(false)
  }

  async function apply(transition: Transition) {
    setBusy(true)
    hapticImpact('medium')

    const res = await apiFetch(`/api/tracker/issues/${issueKey}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transitionId: transition.id }),
    })

    if (res.ok) {
      const data = (await res.json()) as { transitions: Transition[] }
      setTransitions(data.transitions)
      setOpen(false)
      showToast({ kind: 'success', message: `Статус: ${transition.to}` })
      onChanged()
    } else {
      // Чаще всего это обязательное поле очереди — текст Трекера объясняет,
      // какое именно, поэтому показываем его целиком.
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      showToast({ kind: 'error', message: data.error ?? 'Трекер отказал в переходе' })
    }
    setBusy(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-3 py-2 text-[14px] font-medium text-[var(--tg-theme-text-color,#000)] disabled:opacity-50"
      >
        {statusLabel}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div className="mt-1.5 flex flex-col gap-1 rounded-lg border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-1">
          {loading ? (
            <span className="px-3 py-2 text-[13px] text-[var(--tg-theme-hint-color,#8e8e93)]">
              Спрашиваю Трекер…
            </span>
          ) : transitions.length === 0 ? (
            <span className="px-3 py-2 text-[13px] text-[var(--tg-theme-hint-color,#8e8e93)]">
              Переходов нет
            </span>
          ) : (
            transitions.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={busy}
                onClick={() => apply(t)}
                className="rounded-md px-3 py-2 text-left text-[14px] text-[var(--tg-theme-text-color,#000)] active:bg-[var(--tg-theme-secondary-bg-color,#efeff4)] disabled:opacity-50"
              >
                {t.display}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
