'use client'

import { useEffect, useState } from 'react'
import { Cloud, CloudOff } from 'lucide-react'
import { subscribeOutbox, type OutboxEntry } from '@/lib/api/outbox'
import { flushOutbox } from '@/lib/api/mutate'

/**
 * Индикатор синхронизации.
 * Показывается над NavBar, только когда в outbox что-то есть или пользователь оффлайн.
 * При клике пытается прогнать outbox принудительно.
 */
export function SyncIndicator() {
  const [entries, setEntries] = useState<OutboxEntry[]>([])
  const [online, setOnline] = useState(true)

  useEffect(() => subscribeOutbox(setEntries), [])

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    setOnline(navigator.onLine)
    const goOnline = () => {
      setOnline(true)
      void flushOutbox(entries)
    }
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [entries])

  // При загрузке страницы — попытка прогнать накопленное
  useEffect(() => {
    if (entries.length > 0 && online) {
      void flushOutbox(entries)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (entries.length === 0 && online) return null

  const Icon = online ? Cloud : CloudOff

  return (
    <button
      type="button"
      onClick={() => void flushOutbox(entries)}
      className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+0.5rem)] right-3 z-[55] flex items-center gap-1.5 rounded-full bg-amber-500/95 text-white text-xs font-medium px-3 py-1.5 shadow-md active:scale-95 transition-transform"
      aria-label={online ? 'Несохранённые изменения' : 'Нет сети, изменения в очереди'}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      {entries.length > 0 && <span>{entries.length}</span>}
    </button>
  )
}
