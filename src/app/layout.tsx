import type { Metadata } from 'next'
import './globals.css'

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
      <body className="antialiased">{children}</body>
    </html>
  )
}
