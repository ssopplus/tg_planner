'use client'

import { ReadingHeader } from '@/components/reading/reading-header'
import { ReadingProvider } from '@/components/reading/reading-provider'

/** Раздел «Чтение»: тренажёр скорочтения и английских слов («Темп чтения»). */
export default function ReadingLayout({ children }: { children: React.ReactNode }) {
  return (
    <ReadingProvider>
      <ReadingHeader />
      <div className="flex flex-col gap-3 pb-4">{children}</div>
    </ReadingProvider>
  )
}
