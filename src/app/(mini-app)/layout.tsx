'use client'

import { useEffect } from 'react'
import { NavBar } from '@/components/layout/nav-bar'
import { SyncIndicator } from '@/components/layout/sync-indicator'
import { ToastHost } from '@/components/ui/toast-host'
import { whenWebAppReady, webAppExpand } from '@/lib/telegram/webapp'

export default function MiniAppLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // На iOS WKWebView Telegram.WebApp иногда инициализируется чуть позже
    // окончания первого React-эффекта. Ждём с ретраем, потом сигналим ready().
    whenWebAppReady().then(() => {
      webAppExpand()
    })
  }, [])

  return (
    <>
      <main className="pb-20 min-h-dvh">{children}</main>
      <ToastHost />
      <SyncIndicator />
      <NavBar />
    </>
  )
}
