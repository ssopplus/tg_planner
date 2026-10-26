import type { ReadingLang, ReadingSettings } from './types'

export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  lang: 'ru',
  pacerWpm: 260,
  rsvpWpm: 300,
  rsvpChunk: 1,
  silentBpm: 90,
  lastText: { ru: null, en: null },
}

/** Диапазоны ползунков из ТЗ: значение вне них в настройках — мусор, а не выбор. */
export const WPM_LIMITS = {
  rsvp: { min: 150, max: 900 },
  pacer: { min: 120, max: 800 },
  silentBpm: { min: 60, max: 160 },
} as const

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function textId(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/**
 * Настройки из `users.settings.reading`. JSON пишет клиент, поэтому
 * каждое поле проверяется отдельно: битое поле получает значение по умолчанию,
 * остальные сохраняются.
 */
export function parseReadingSettings(raw: unknown): ReadingSettings {
  const d = DEFAULT_READING_SETTINGS
  if (!raw || typeof raw !== 'object') return { ...d, lastText: { ...d.lastText } }
  const r = raw as Record<string, unknown>
  const last = (r.lastText && typeof r.lastText === 'object' ? r.lastText : {}) as Record<
    ReadingLang,
    unknown
  >
  return {
    lang: r.lang === 'en' ? 'en' : 'ru',
    pacerWpm: clampNumber(r.pacerWpm, WPM_LIMITS.pacer.min, WPM_LIMITS.pacer.max, d.pacerWpm),
    rsvpWpm: clampNumber(r.rsvpWpm, WPM_LIMITS.rsvp.min, WPM_LIMITS.rsvp.max, d.rsvpWpm),
    rsvpChunk: r.rsvpChunk === 2 || r.rsvpChunk === 3 ? r.rsvpChunk : 1,
    silentBpm: clampNumber(
      r.silentBpm,
      WPM_LIMITS.silentBpm.min,
      WPM_LIMITS.silentBpm.max,
      d.silentBpm,
    ),
    lastText: { ru: textId(last.ru), en: textId(last.en) },
  }
}
