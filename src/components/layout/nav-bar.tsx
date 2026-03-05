'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sun, ListTodo, FolderOpen, Settings } from 'lucide-react'

const tabs = [
  { href: '/today', label: 'Мой день', icon: Sun },
  { href: '/tasks', label: 'Задачи', icon: ListTodo },
  { href: '/projects', label: 'Проекты', icon: FolderOpen },
  { href: '/settings', label: 'Настройки', icon: Settings },
]

export function NavBar() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--tg-theme-section-bg-color,#fff)] border-t border-border safe-bottom">
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
