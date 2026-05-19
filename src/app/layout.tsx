import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export const metadata: Metadata = {
  title: 'TG Planer',
  description: 'Telegram задачник',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru">
      <head>
        {/*
          Telegram WebApp SDK подключаем синхронно в <head>, чтобы window.Telegram.WebApp
          был доступен до того, как React-компоненты начнут его читать в useEffect.
          В Next 16 нативный <script> в RSC иногда выполняется после клиентских эффектов
          (особенно в WKWebView на iOS) — отсюда «висящий» серый экран.
        */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  )
}
