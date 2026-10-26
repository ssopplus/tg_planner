'use client'

import { useMemo } from 'react'
import type { ReadingText } from '@/lib/reading/types'
import { useReading } from './reading-provider'
import { fieldClass } from './ui'

/** Подпись текста в списке: уровень, название и номер части. */
export function textLabel(text: ReadingText): string {
  const level = text.level ? `${text.level} · ` : ''
  const own = text.source === 'builtin' ? '' : ' (свой)'
  return `${level}${text.title}${own}`
}

/**
 * Выбранный текст упражнения. Выбор общий для всех упражнений одного языка и
 * сохраняется в настройках — следующее упражнение открывается на том же тексте.
 */
export function useSelectedText(filter?: (text: ReadingText) => boolean) {
  const { texts, settings, lang, updateSettings } = useReading()
  const list = useMemo(() => (filter ? texts.filter(filter) : texts), [texts, filter])
  const saved = settings.lastText[lang]
  const text = list.find((t) => t.id === saved) ?? list[0]

  const select = (id: string) => updateSettings({ lastText: { ...settings.lastText, [lang]: id } })

  return { text, list, select }
}

export function TextPicker({
  list,
  value,
  onChange,
  disabled,
}: {
  list: ReadingText[]
  value: string | undefined
  onChange: (id: string) => void
  disabled?: boolean
}) {
  return (
    <select
      aria-label="Текст"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`${fieldClass} truncate py-1.5`}
    >
      {list.map((text) => (
        <option key={text.id} value={text.id}>
          {textLabel(text)}
        </option>
      ))}
    </select>
  )
}
