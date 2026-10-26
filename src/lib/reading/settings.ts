import type { HabrFeed, ReadingLang, ReadingSettings } from './types'

/** Темы по умолчанию: разработка, AI и Claude Code. */
export const DEFAULT_HABR_FEEDS: HabrFeed[] = [
  { kind: 'hub', id: 'artificial_intelligence' },
  { kind: 'hub', id: 'programming' },
  { kind: 'hub', id: 'webdev' },
  { kind: 'search', q: 'claude code' },
]

/** Предел лент: каждая — отдельный запрос к Хабру при открытии раздела. */
export const MAX_HABR_FEEDS = 8

export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  lang: 'ru',
  pacerWpm: 260,
  rsvpWpm: 300,
  rsvpChunk: 1,
  silentBpm: 90,
  lastText: { ru: null, en: null },
  remindEnabled: true,
  remindTime: '19:00',
  streakGuard: true,
  habrFeeds: DEFAULT_HABR_FEEDS,
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

function parseTime(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const m = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return fallback
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

function parseFeeds(value: unknown): HabrFeed[] {
  if (!Array.isArray(value)) return [...DEFAULT_HABR_FEEDS]
  const feeds: HabrFeed[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const f = item as Record<string, unknown>
    if (f.kind === 'hub' && typeof f.id === 'string' && /^[a-z0-9_-]{1,64}$/i.test(f.id)) {
      feeds.push({ kind: 'hub', id: f.id.toLowerCase() })
    } else if (f.kind === 'search' && typeof f.q === 'string' && f.q.trim()) {
      feeds.push({ kind: 'search', q: f.q.trim().slice(0, 80) })
    }
  }
  return feeds.slice(0, MAX_HABR_FEEDS)
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
  if (!raw || typeof raw !== 'object') {
    return { ...d, lastText: { ...d.lastText }, habrFeeds: [...d.habrFeeds] }
  }
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
    remindEnabled: r.remindEnabled !== false,
    remindTime: parseTime(r.remindTime, d.remindTime),
    streakGuard: r.streakGuard !== false,
    habrFeeds: parseFeeds(r.habrFeeds),
  }
}
