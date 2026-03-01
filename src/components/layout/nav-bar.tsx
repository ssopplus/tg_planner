'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sun, ListTodo, FolderOpen, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/today', icon: Sun, label: 'Мой день' },
  { href: '/tasks', icon: ListTodo, label: 'Задачи' },
  { href: '/projects', icon: FolderOpen, label: 'Проекты' },
  { href: '/settings', icon: Settings, label: 'Настройки' },
]

export function NavBar() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-[var(--tg-theme-bg-color,#fff)] dark:border-gray-800 dark:bg-[var(--tg-theme-bg-color,#000)]">
      <div className="flex h-14 items-center justify-around px-2">
        {navItems.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href || pathname?.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-0.5 px-3 py-1 text-xs transition-colors',
                isActive
                  ? 'text-[var(--tg-theme-button-color,#3b82f6)]'
                  : 'text-[var(--tg-theme-hint-color,#9ca3af)]',
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
