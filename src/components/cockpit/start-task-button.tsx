'use client'

import { useCallback, useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import { apiFetch } from '@/lib/telegram/webapp'

interface CommandState {
  id: string
  status: 'pending' | 'sent' | 'done' | 'failed'
  result: { error?: string; output?: string } | null
}

interface CockpitSnapshot {
  syncedAt: string | null
  sessions: { id: string; name: string; taskKey?: string | null; tasks?: { issue: string | null }[] }[]
  commands: (CommandState & { kind: string; payload: { issueKey?: string } })[]
}

const LABEL: Record<CommandState['status'], string> = {
  pending: 'Ждёт dev-cockpit на рабочей машине…',
  sent: 'Запускаю сессию…',
  done: 'Сессия запущена — смотри раздел «Сессии»',
  failed: 'Не запустилось',
}

/**
 * «Взять в работу в Claude»: dev-cockpit на рабочей машине запускает фоновую
 * сессию `claude --bg "/start-task КЛЮЧ"`. Дальше её вопросы и запросы
 * разрешений приходят в раздел «Сессии».
 */
export function StartTaskButton({ issueKey, title }: { issueKey: string; title: string }) {
  const [snap, setSnap] = useState<CockpitSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await apiFetch('/api/cockpit')
    if (res.ok) setSnap((await res.json()) as CockpitSnapshot)
  }, [])

  const cmd = snap?.commands.find((c) => c.kind === 'start-task' && c.payload.issueKey === issueKey)
  const running = snap?.sessions.filter(
    (s) => s.taskKey === issueKey || s.tasks?.some((t) => t.issue === issueKey),
  )

  useEffect(() => {
    load()
  }, [load])

  // Пока команда в пути — опрашиваем чаще, чтобы увидеть итог без перезагрузки.
  useEffect(() => {
    if (!cmd || cmd.status === 'done' || cmd.status === 'failed') return
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [cmd, load])

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch('/api/cockpit/commands', {
        method: 'POST',
        body: JSON.stringify({ kind: 'start-task', issueKey, title }),
      })
      if (!res.ok) setError(((await res.json()) as { error?: string }).error ?? 'Ошибка')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const stale = !snap?.syncedAt || Date.now() - new Date(snap.syncedAt).getTime() > 120_000
  const inFlight = cmd && (cmd.status === 'pending' || cmd.status === 'sent')

  return (
    <section className="flex flex-col gap-1.5 rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-3">
      <button
        type="button"
        disabled={busy || inFlight}
        onClick={start}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--tg-theme-button-color,#007aff)] px-3 py-2 text-[14px] font-medium text-[var(--tg-theme-button-text-color,#fff)] disabled:opacity-50"
      >
        <Play className="h-4 w-4" />
        Взять в работу в Claude
      </button>
      {running?.length ? (
        <p className="text-[12px] text-[var(--tg-theme-hint-color,#8e8e93)]">
          Уже идёт: {running.map((s) => s.name).join(', ')}
        </p>
      ) : null}
      {stale ? (
        <p className="text-[12px] text-amber-600">dev-cockpit давно не выходил на связь — команда подождёт, пока машина проснётся.</p>
      ) : null}
      {cmd ? (
        <p className={`text-[12px] ${cmd.status === 'failed' ? 'text-red-500' : 'text-[var(--tg-theme-hint-color,#8e8e93)]'}`}>
          {LABEL[cmd.status]}
          {cmd.result?.error ? `: ${cmd.result.error}` : ''}
        </p>
      ) : (
        <p className="text-[12px] leading-snug text-[var(--tg-theme-hint-color,#8e8e93)]">
          На рабочей машине стартует фоновая сессия <span className="font-mono">/start-task {issueKey}</span>. Её
          вопросы и запросы разрешений придут в раздел «Сессии».
        </p>
      )}
      {error ? <p className="text-[12px] text-red-500">{error}</p> : null}
    </section>
  )
}
