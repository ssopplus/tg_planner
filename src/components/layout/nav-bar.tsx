'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { apiFetch } from '@/lib/telegram/webapp'
import {
  BookOpen,
  Briefcase,
  CheckSquare,
  NotebookText,
  Settings,
  TerminalSquare,
} from 'lucide-react'

/**
 * Разделы приложения. Две половины — рабочая (Трекер) и жизненная (доски) —
 * равноправны и не пересекаются. «Архив» показывает задачи из Obsidian только
 * на чтение, поэтому стоит после них, а не между.
 *
 * «Сессии» — сессии Claude Code с рабочей машины (dev-cockpit). Запросы сессий
 * в чат бота не пишутся, поэтому о них сообщает счётчик на этой вкладке.
 *
 * «Чтение» — тренажёр скорочтения и английских слов, отдельный от задач.
 *
 * Доски в эту панель не выносятся: их может стать сколько угодно, а сюда
 * влезает шесть пунктов (на 360 px — по 60 px на пункт). Переключение досок
 * живёт лентой внутри раздела.
 */
const tabs = [
  { href: '/tracker', label: 'Трекер', icon: Briefcase },
  { href: '/boards', label: 'Личное', icon: CheckSquare },
  { href: '/reading', label: 'Чтение', icon: BookOpen },
  { href: '/sessions', label: 'Сессии', icon: TerminalSquare },
  { href: '/archive', label: 'Архив', icon: NotebookText },
  { href: '/settings', label: 'Ещё', icon: Settings },
]

/** Как часто обновлять счётчик ожидающих запросов сессий. */
const COCKPIT_POLL_MS = 15_000

/** Число запросов сессий Claude Code, которые ждут ответа. */
function useCockpitPending(): number {
  const [pending, setPending] = useState(0)
  useEffect(() => {
    const load = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await apiFetch('/api/cockpit?count')
        if (res.ok) setPending(((await res.json()) as { pending: number }).pending)
      } catch {
        // Сеть мигнула — покажем прежнее число, следующий опрос поправит.
      }
    }
    load()
    const timer = setInterval(load, COCKPIT_POLL_MS)
    document.addEventListener('visibilitychange', load)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', load)
    }
  }, [])
  return pending
}

export function NavBar() {
  const pathname = usePathname()
  const cockpitPending = useCockpitPending()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--tg-theme-section-bg-color,#fff)] border-t border-border pb-[max(env(safe-area-inset-bottom,0px),0.5rem)]">
      <div className="flex items-center justify-around h-14 max-w-md mx-auto">
        {tabs.map(({ href, label, icon: Icon }) => {
          // «План» cockpit открывается из «Сессий» и живёт под той же вкладкой.
          const isActive =
            pathname === href || pathname?.startsWith(href + '/') || (href === '/sessions' && pathname === '/plan')
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors ${
                isActive
                  ? 'text-[var(--tg-theme-button-color,#007aff)]'
                  : 'text-[var(--tg-theme-hint-color,#8e8e93)]'
              }`}
            >
              <span className="relative">
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.2 : 1.8} />
                {href === '/sessions' && cockpitPending > 0 ? (
                  <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">
                    {cockpitPending}
                  </span>
                ) : null}
              </span>
              <span className="text-[10px] font-medium leading-none">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
