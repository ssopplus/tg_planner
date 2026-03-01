'use client'

import { useEffect } from 'react'
import { NavBar } from '@/components/layout/nav-bar'
import { webAppReady, webAppExpand } from '@/lib/telegram/webapp'

export default function MiniAppLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Инициализация Telegram WebApp SDK
    webAppReady()
    webAppExpand()
  }, [])

  return (
    <div className="min-h-screen bg-[var(--tg-theme-secondary-bg-color,var(--tg-theme-bg-color,#f2f2f7))] text-[var(--tg-theme-text-color,#000)] dark:text-[var(--tg-theme-text-color,#fff)]">
      {/* Telegram WebApp SDK скрипт */}
      <script src="https://telegram.org/js/telegram-web-app.js" />
      <main className="pb-16">{children}</main>
      <NavBar />
    </div>
  )
}
