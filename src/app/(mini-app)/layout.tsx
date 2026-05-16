'use client'

import { useEffect } from 'react'
import { NavBar } from '@/components/layout/nav-bar'
import { SyncIndicator } from '@/components/layout/sync-indicator'
import { ToastHost } from '@/components/ui/toast-host'
import { webAppReady, webAppExpand } from '@/lib/telegram/webapp'

export default function MiniAppLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    webAppReady()
    webAppExpand()
  }, [])

  return (
    <>
      <script src="https://telegram.org/js/telegram-web-app.js" />
      <main className="pb-20 min-h-dvh">{children}</main>
      <ToastHost />
      <SyncIndicator />
      <NavBar />
    </>
  )
}
