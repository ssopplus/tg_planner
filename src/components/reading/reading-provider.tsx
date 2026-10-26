'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/telegram/webapp'
import { showToast } from '@/lib/api/toast'
import { BUILTIN_TEXTS } from '@/lib/reading/builtin'
import { DEFAULT_READING_SETTINGS, parseReadingSettings } from '@/lib/reading/settings'
import { dayKey } from '@/lib/reading/stats'
import type {
  CardGrade,
  ReadingCard,
  ReadingLang,
  ReadingSession,
  ReadingSettings,
  ReadingText,
} from '@/lib/reading/types'

/** Пауза перед сохранением настроек: ползунок темпа шлёт изменения на каждый шаг. */
const SAVE_DEBOUNCE_MS = 600

/** Тренировка от упражнения: тип, язык и день проставляет провайдер. */
export type NewSession = Omit<ReadingSession, 'id' | 'createdAt' | 'day' | 'lang'> & {
  lang?: ReadingLang
}

interface ReadingContextValue {
  /** Настройки и история загружены с сервера — до этого показываем значения по умолчанию. */
  ready: boolean
  settings: ReadingSettings
  updateSettings: (patch: Partial<ReadingSettings>) => void
  lang: ReadingLang
  setLang: (lang: ReadingLang) => void
  /** Встроенные и свои тексты на языке тренировок; свои — первыми. */
  texts: ReadingText[]
  customTexts: ReadingText[]
  reloadTexts: () => Promise<void>
  getText: (id: string | null | undefined) => ReadingText | undefined
  sessions: ReadingSession[]
  addSession: (session: NewSession) => Promise<void>
  cards: ReadingCard[]
  addCard: (input: { en: string; ru: string; ctx: string; surface?: string }) => Promise<boolean>
  gradeCard: (id: string, grade: CardGrade) => Promise<void>
  deleteCard: (id: string) => Promise<void>
  reloadState: () => Promise<void>
}

const ReadingContext = createContext<ReadingContextValue | null>(null)

export function useReading(): ReadingContextValue {
  const value = useContext(ReadingContext)
  if (!value) throw new Error('useReading вызван вне ReadingProvider')
  return value
}

/**
 * Общее состояние раздела «Чтение»: язык тренировок, настройки упражнений,
 * тексты, тренировки и карточки. Настройки живут в `users.settings.reading`;
 * `/api/settings` мержит JSON только на верхнем уровне, поэтому объект
 * `reading` уходит целиком.
 */
export function ReadingProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [settings, setSettings] = useState<ReadingSettings>(DEFAULT_READING_SETTINGS)
  const [customTexts, setCustomTexts] = useState<ReadingText[]>([])
  const [sessions, setSessions] = useState<ReadingSession[]>([])
  const [cards, setCards] = useState<ReadingCard[]>([])
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

  const reloadState = useCallback(async () => {
    try {
      const res = await apiFetch('/api/reading/state')
      if (!res.ok) return
      const data = (await res.json()) as { sessions: ReadingSession[]; cards: ReadingCard[] }
      setSessions(data.sessions)
      setCards(data.cards)
    } catch {
      // Без истории упражнения всё равно работают; статистика подтянется позже.
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
      } catch {
        // Останутся настройки по умолчанию.
      }
    }
    Promise.all([loadSettings(), reloadTexts(), reloadState()]).finally(() => setReady(true))
  }, [reloadTexts, reloadState])

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

  const addSession = useCallback(async (input: NewSession) => {
    const body = { ...input, lang: input.lang ?? settingsRef.current.lang, day: dayKey(new Date()) }
    // Тренировка видна сразу: план дня отмечается, даже если сеть подвиснет.
    const tempId = `tmp-${Date.now()}`
    const optimistic: ReadingSession = { ...body, id: tempId, createdAt: new Date().toISOString() }
    setSessions((prev) => [...prev, optimistic])
    try {
      const res = await apiFetch('/api/reading/sessions', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(String(res.status))
      const saved = (await res.json()) as ReadingSession
      setSessions((prev) => prev.map((s) => (s.id === tempId ? saved : s)))
    } catch {
      setSessions((prev) => prev.filter((s) => s.id !== tempId))
      showToast({ kind: 'error', message: 'Тренировка не сохранилась — нет связи' })
    }
  }, [])

  const addCard = useCallback(
    async (input: { en: string; ru: string; ctx: string; surface?: string }) => {
      try {
        const res = await apiFetch('/api/reading/cards', {
          method: 'POST',
          body: JSON.stringify(input),
        })
        if (!res.ok) throw new Error(String(res.status))
        const card = (await res.json()) as ReadingCard
        setCards((prev) => [...prev.filter((c) => c.id !== card.id), card])
        return true
      } catch {
        showToast({ kind: 'error', message: 'Слово не добавилось — нет связи' })
        return false
      }
    },
    [],
  )

  const gradeCard = useCallback(async (id: string, grade: CardGrade) => {
    try {
      const res = await apiFetch(`/api/reading/cards/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ grade }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const card = (await res.json()) as ReadingCard
      setCards((prev) => prev.map((c) => (c.id === id ? card : c)))
    } catch {
      showToast({ kind: 'error', message: 'Оценка не сохранилась — нет связи' })
    }
  }, [])

  const deleteCard = useCallback(async (id: string) => {
    const res = await apiFetch(`/api/reading/cards/${id}`, { method: 'DELETE' }).catch(() => null)
    if (!res?.ok) {
      showToast({ kind: 'error', message: 'Не удалось удалить слово' })
      return
    }
    setCards((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const allTexts = useMemo(() => [...customTexts, ...BUILTIN_TEXTS], [customTexts])
  const texts = useMemo(
    () => allTexts.filter((t) => t.lang === settings.lang),
    [allTexts, settings.lang],
  )
  const getText = useCallback(
    (id: string | null | undefined) => (id ? allTexts.find((t) => t.id === id) : undefined),
    [allTexts],
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
      getText,
      sessions,
      addSession,
      cards,
      addCard,
      gradeCard,
      deleteCard,
      reloadState,
    }),
    [
      ready,
      settings,
      updateSettings,
      setLang,
      texts,
      customTexts,
      reloadTexts,
      getText,
      sessions,
      addSession,
      cards,
      addCard,
      gradeCard,
      deleteCard,
      reloadState,
    ],
  )

  return <ReadingContext.Provider value={value}>{children}</ReadingContext.Provider>
}
