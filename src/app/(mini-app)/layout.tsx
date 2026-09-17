'use client'

import { useEffect } from 'react'
import { NavBar } from '@/components/layout/nav-bar'
import { SyncIndicator } from '@/components/layout/sync-indicator'
import { ToastHost } from '@/components/ui/toast-host'
import {
  whenWebAppReady,
  webAppExpand,
  webAppRequestFullscreen,
  webAppDisableVerticalSwipes,
} from '@/lib/telegram/webapp'

export default function MiniAppLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // На iOS WKWebView Telegram.WebApp иногда инициализируется чуть позже
    // окончания первого React-эффекта. Ждём с ретраем, потом сигналим ready().
    whenWebAppReady().then(() => {
      webAppExpand()
      webAppRequestFullscreen()
      webAppDisableVerticalSwipes()
    })
  }, [])

  return (
    <>
      {/*
        В полноэкранном режиме кнопки Telegram («⋮» и «✕») лежат поверх
        страницы, а системная шапка — над ней. Клиент отдаёт нужный отступ в
        --tg-content-safe-area-inset-top; вне fullscreen переменной нет и
        подставляется 0px, так что обычный режим не меняется.
      */}
      <main
        className="pb-20 min-h-dvh"
        style={{ paddingTop: 'var(--tg-content-safe-area-inset-top, 0px)' }}
      >
        {children}
      </main>
      <ToastHost />
      <SyncIndicator />
      <NavBar />
    </>
  )
}
