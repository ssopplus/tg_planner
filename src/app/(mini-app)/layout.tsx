'use client'

import { useCallback, useEffect, useState } from 'react'
import { NavBar } from '@/components/layout/nav-bar'
import { SyncIndicator } from '@/components/layout/sync-indicator'
import { ToastHost } from '@/components/ui/toast-host'
import {
  whenWebAppReady,
  webAppExpand,
  webAppRequestFullscreen,
  webAppDisableVerticalSwipes,
  webAppTopInset,
  onWebAppInsetChange,
} from '@/lib/telegram/webapp'

export default function MiniAppLayout({ children }: { children: React.ReactNode }) {
  // В полноэкранном режиме кнопки Telegram лежат поверх страницы: без отступа
  // заголовок оказывается под ними. Величину отдаёт клиент, и она меняется —
  // при повороте экрана и при входе/выходе из полноэкранного режима.
  const [topInset, setTopInset] = useState(0)
  const syncInset = useCallback(() => setTopInset(webAppTopInset()), [])

  useEffect(() => {
    // На iOS WKWebView Telegram.WebApp иногда инициализируется чуть позже
    // окончания первого React-эффекта. Ждём с ретраем, потом сигналим ready().
    let unsubscribe = () => {}
    whenWebAppReady().then(() => {
      webAppExpand()
      webAppRequestFullscreen()
      webAppDisableVerticalSwipes()
      syncInset()
      unsubscribe = onWebAppInsetChange(syncInset)
    })
    return () => unsubscribe()
  }, [syncInset])

  return (
    <>
      <main className="pb-20 min-h-dvh" style={{ paddingTop: topInset }}>
        {children}
      </main>
      <ToastHost />
      <SyncIndicator />
      <NavBar />
    </>
  )
}
