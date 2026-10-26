'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/telegram/webapp'
import { BUILTIN_TEXTS } from '@/lib/reading/builtin'
import { DEFAULT_READING_SETTINGS, parseReadingSettings } from '@/lib/reading/settings'
import type { ReadingLang, ReadingSettings, ReadingText } from '@/lib/reading/types'

/** Пауза перед сохранением настроек: ползунок темпа шлёт изменения на каждый шаг. */
const SAVE_DEBOUNCE_MS = 600

interface ReadingContextValue {
  /** Настройки загружены с сервера — до этого показываем значения по умолчанию. */
  ready: boolean
  settings: ReadingSettings
  updateSettings: (patch: Partial<ReadingSettings>) => void
  lang: ReadingLang
  setLang: (lang: ReadingLang) => void
  /** Встроенные и свои тексты на языке тренировок; свои — первыми. */
  texts: ReadingText[]
  customTexts: ReadingText[]
  reloadTexts: () => Promise<void>
}

const ReadingContext = createContext<ReadingContextValue | null>(null)

export function useReading(): ReadingContextValue {
  const value = useContext(ReadingContext)
  if (!value) throw new Error('useReading вызван вне ReadingProvider')
  return value
}

/**
 * Общее состояние раздела «Чтение»: язык тренировок, настройки упражнений и
 * список текстов. Настройки живут в `users.settings.reading`; `/api/settings`
 * мержит JSON только на верхнем уровне, поэтому объект `reading` уходит целиком.
 */
export function ReadingProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [settings, setSettings] = useState<ReadingSettings>(DEFAULT_READING_SETTINGS)
  const [customTexts, setCustomTexts] = useState<ReadingText[]>([])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Последние настройки для сохранения: правки идут подряд, и каждая должна
  // накладываться на предыдущую, а не на значение из замыкания.
  const settingsRef = useRef(settings)

  const reloadTexts = useCallback(async () => {
    try {
      const res = await apiFetch('/api/reading/texts')
      if (res.ok) setCustomTexts((await res.json()) as ReadingText[])
    } catch {
      // Сеть мигнула — останется прежний список, следующая загрузка поправит.
    }
  }, [])

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await apiFetch('/api/settings')
        if (res.ok) {
          const row = (await res.json()) as { settings?: Record<string, unknown> }
          const loaded = parseReadingSettings(row.settings?.reading)
          settingsRef.current = loaded
          setSettings(loaded)
        }
      } finally {
        setReady(true)
      }
    }
    loadSettings()
    reloadTexts()
  }, [reloadTexts])

  useEffect(() => () => clearTimeout(saveTimer.current ?? undefined), [])

  const updateSettings = useCallback((patch: Partial<ReadingSettings>) => {
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    setSettings(next)
    clearTimeout(saveTimer.current ?? undefined)
    saveTimer.current = setTimeout(() => {
      apiFetch('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ settings: { reading: next } }),
      }).catch(() => {
        // Настройки не критичны: при следующей правке уйдут снова.
      })
    }, SAVE_DEBOUNCE_MS)
  }, [])

  const setLang = useCallback((lang: ReadingLang) => updateSettings({ lang }), [updateSettings])

  const texts = useMemo(
    () => [...customTexts, ...BUILTIN_TEXTS].filter((t) => t.lang === settings.lang),
    [customTexts, settings.lang],
  )

  const value = useMemo<ReadingContextValue>(
    () => ({
      ready,
      settings,
      updateSettings,
      lang: settings.lang,
      setLang,
      texts,
      customTexts,
      reloadTexts,
    }),
    [ready, settings, updateSettings, setLang, texts, customTexts, reloadTexts],
  )

  return <ReadingContext.Provider value={value}>{children}</ReadingContext.Provider>
}
