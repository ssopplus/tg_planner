'use client'

import { usePathname, useRouter } from 'next/navigation'
import { TabStrip } from '@/components/ui/tab-strip'
import { hapticImpact } from '@/lib/telegram/webapp'
import type { ReadingLang } from '@/lib/reading/types'
import { useReading } from './reading-provider'

/** Разделы тренажёра в порядке плана дня. `''` — экран «Сегодня». */
export const READING_SECTIONS = [
  { id: '', label: 'Сегодня' },
  { id: 'rsvp', label: 'Разминка' },
  { id: 'pacer', label: 'Указка' },
  { id: 'silent', label: 'Без голоса' },
  { id: 'test', label: 'Тест' },
  { id: 'english', label: 'Английский' },
  { id: 'cards', label: 'Карточки' },
  { id: 'texts', label: 'Тексты' },
  { id: 'settings', label: 'Ещё' },
] as const

const LANGS: { id: ReadingLang; label: string }[] = [
  { id: 'ru', label: 'RU' },
  { id: 'en', label: 'EN' },
]

/**
 * Шапка раздела: название, переключатель языка тренировок и лента упражнений.
 * Язык меняет набор текстов во всех упражнениях на скорость; статистика по
 * языкам считается отдельно.
 */
export function ReadingHeader() {
  const router = useRouter()
  const pathname = usePathname() ?? '/reading'
  const { lang, setLang } = useReading()
  const activeId = pathname.replace(/^\/reading\/?/, '').split('/')[0]

  return (
    // Обычный блок, а не flex-колонка: WebKit сжимал прокручиваемую ленту по
    // высоте до половины кнопок, а полоса прокрутки ложилась поверх них.
    <div className="pt-4 pb-2">
      <div className="mb-3 flex items-center justify-between gap-2 px-4">
        <h1 className="text-xl font-bold text-[var(--tg-theme-text-color,#000)]">Темп чтения</h1>
        <div
          role="group"
          aria-label="Язык тренировок"
          className="flex overflow-hidden rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] p-0.5"
        >
          {LANGS.map((item) => {
            const isActive = item.id === lang
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  if (isActive) return
                  hapticImpact('light')
                  setLang(item.id)
                }}
                className={`rounded-md px-3 py-1 text-[12px] font-semibold tracking-wide transition-colors ${
                  isActive
                    ? 'bg-[var(--tg-theme-section-bg-color,#fff)] text-[var(--tg-theme-text-color,#000)] shadow-sm'
                    : 'text-[var(--tg-theme-hint-color,#8e8e93)]'
                }`}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      </div>

      <TabStrip
        items={READING_SECTIONS.map((s) => ({ id: s.id, label: s.label }))}
        activeId={activeId}
        onSelect={(id) => router.push(id ? `/reading/${id}` : '/reading')}
      />
    </div>
  )
}
