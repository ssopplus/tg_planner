'use client'

import { useEffect, useState } from 'react'
import { Check, AlertCircle, Info, X } from 'lucide-react'
import { subscribeToasts, dismissToast, type Toast } from '@/lib/api/toast'

const ICON: Record<Toast['kind'], typeof Check> = {
  success: Check,
  error: AlertCircle,
  info: Info,
}

const BG: Record<Toast['kind'], string> = {
  success: 'bg-emerald-500/95',
  error: 'bg-red-500/95',
  info: 'bg-[var(--tg-theme-button-color,#007aff)]/95',
}

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => subscribeToasts(setToasts), [])

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+0.75rem)] left-3 right-3 z-[70] flex flex-col items-center gap-2 max-w-md mx-auto">
      {toasts.map((t) => {
        const Icon = ICON[t.kind]
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm text-white shadow-lg backdrop-blur min-w-[200px] max-w-full ${BG[t.kind]} animate-in slide-in-from-bottom duration-200`}
          >
            <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={2.5} />
            <span className="flex-1 leading-tight">{t.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
              aria-label="Закрыть"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
