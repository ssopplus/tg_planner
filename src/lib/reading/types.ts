/**
 * «Темп чтения» — тренажёр скорочтения (RU/EN) с изучением английских слов.
 * Модель данных из ТЗ, приведённая к хранению в Postgres: встроенные тексты
 * лежат в бандле, свои тексты, сессии и карточки — в таблицах `reading_*`,
 * настройки — в `users.settings.reading`.
 */

export type ReadingLang = 'ru' | 'en'

export type CefrLevel = 'B1' | 'B2' | 'C1'

export interface ReadingQuestion {
  q: string
  options: string[]
  /** Индекс верного варианта в `options`. */
  answer: number
}

/** Откуда пришёл текст. Встроенные тексты — `builtin`, остальные — свои. */
export type ReadingTextSource = 'builtin' | 'paste' | 'file' | 'url' | 'bot' | 'habr' | 'ai'

export interface ReadingText {
  id: string
  lang: ReadingLang
  level?: CefrLevel | null
  title: string
  body: string
  glossary?: Record<string, string> | null
  questions?: ReadingQuestion[] | null
  source: ReadingTextSource
  wordCount: number
  createdAt?: string
}

/** Типы тренировок — они же пункты плана дня. */
export type ReadingSessionType = 'rsvp' | 'pacer' | 'silent' | 'test' | 'read_en' | 'cards'

export interface ReadingSettings {
  lang: ReadingLang
  pacerWpm: number
  rsvpWpm: number
  rsvpChunk: 1 | 2 | 3
  silentBpm: number
  /** Последний выбранный текст по каждому языку — чтобы упражнения открывались на нём. */
  lastText: Record<ReadingLang, string | null>
}
