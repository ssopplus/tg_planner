'use client'

import { useEffect } from 'react'
import { NavBar } from '@/components/layout/nav-bar'
import { webAppReady, webAppExpand } from '@/lib/telegram/webapp'

export default function MiniAppLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    webAppReady()
    webAppExpand()
  }, [])

  return (
    <>
      <script src="https://telegram.org/js/telegram-web-app.js" />
      <main className="pb-16 min-h-dvh">{children}</main>
      <NavBar />
    </>
  )
}
