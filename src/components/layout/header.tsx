'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { showBackButton, hideBackButton } from '@/lib/telegram/webapp'

interface HeaderProps {
  title: string
  showBack?: boolean
}

export function Header({ title, showBack = false }: HeaderProps) {
  const router = useRouter()

  useEffect(() => {
    if (showBack) {
      showBackButton(() => router.back())
      return () => hideBackButton()
    } else {
      hideBackButton()
    }
  }, [showBack, router])

  return (
    <header className="sticky top-0 z-40 bg-[var(--tg-theme-header-bg-color,var(--tg-theme-bg-color,#fff))] px-4 py-3">
      <h1 className="text-lg font-semibold text-[var(--tg-theme-text-color,#000)]">{title}</h1>
    </header>
  )
}
