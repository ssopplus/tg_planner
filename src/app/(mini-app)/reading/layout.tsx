'use client'

import { Literata } from 'next/font/google'
import { ReadingHeader } from '@/components/reading/reading-header'
import { ReadingProvider } from '@/components/reading/reading-provider'

/**
 * Шрифт для текстов упражнений: книжная антиква с кириллицей, на ней глазу
 * проще держать строку, чем на системном гротеске интерфейса.
 */
const readingFont = Literata({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '600'],
  variable: '--font-reading',
  display: 'swap',
})

/** Раздел «Чтение»: тренажёр скорочтения и английских слов («Темп чтения»). */
export default function ReadingLayout({ children }: { children: React.ReactNode }) {
  return (
    <ReadingProvider>
      <div className={readingFont.variable}>
        <ReadingHeader />
        <div className="flex flex-col gap-3 pb-4">{children}</div>
      </div>
    </ReadingProvider>
  )
}
