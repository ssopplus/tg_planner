'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Briefcase, CheckSquare, NotebookText, Settings } from 'lucide-react'

/**
 * Разделы приложения. Две половины — рабочая (Трекер) и жизненная (доски) —
 * равноправны и не пересекаются. «Архив» показывает задачи из Obsidian только
 * на чтение, поэтому стоит после них, а не между.
 *
 * Доски в эту панель не выносятся: их может стать сколько угодно, а сюда
 * влезает четыре пункта. Переключение досок живёт лентой внутри раздела.
 */
const tabs = [
  { href: '/tracker', label: 'Трекер', icon: Briefcase },
  { href: '/boards', label: 'Личное', icon: CheckSquare },
  { href: '/archive', label: 'Архив', icon: NotebookText },
  { href: '/settings', label: 'Ещё', icon: Settings },
]

export function NavBar() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--tg-theme-section-bg-color,#fff)] border-t border-border pb-[max(env(safe-area-inset-bottom,0px),0.5rem)]">
      <div className="flex items-center justify-around h-14 max-w-md mx-auto">
        {tabs.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname?.startsWith(href + '/')
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
              <Icon className="h-5 w-5" strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[10px] font-medium leading-none">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
