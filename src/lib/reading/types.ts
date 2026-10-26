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
  sourceUrl?: string | null
  /** Книга или статья, нарезанная на части: общее название, номер части и их число. */
  collection?: string | null
  part?: number | null
  parts?: number | null
  createdAt?: string
}

/** Типы тренировок — они же пункты плана дня. */
export type ReadingSessionType = 'rsvp' | 'pacer' | 'silent' | 'test' | 'read_en' | 'cards'

export interface ReadingSession {
  id: string
  type: ReadingSessionType
  lang: ReadingLang
  /** Локальная дата пользователя, YYYY-MM-DD. */
  day: string
  wpm?: number | null
  comp?: number | null
  ms?: number | null
  textId?: string | null
  title?: string | null
  cardsReviewed?: number | null
  wordsSaved?: number | null
  createdAt: string
}

export interface ReadingCard {
  id: string
  en: string
  ru: string
  ctx: string
  forms: string[]
  box: number
  dueAt: string
  createdAt: string
}

/** Оценка карточки: 0 — «Не помню», 1 — «С трудом», 2 — «Помню». */
export type CardGrade = 0 | 1 | 2

/** Лента Хабра: хаб или поисковый запрос. */
export type HabrFeed = { kind: 'hub'; id: string } | { kind: 'search'; q: string }

export interface ReadingSettings {
  lang: ReadingLang
  pacerWpm: number
  rsvpWpm: number
  rsvpChunk: 1 | 2 | 3
  silentBpm: number
  /** Последний выбранный текст по каждому языку — чтобы упражнения открывались на нём. */
  lastText: Record<ReadingLang, string | null>
  /** Напоминание в боте, если сегодня ещё не занимались. */
  remindEnabled: boolean
  /** Время напоминания по часовому поясу пользователя, HH:MM. */
  remindTime: string
  /** Вечернее «серия сгорит» в 21:30, если серия есть, а сегодня тренировки не было. */
  streakGuard: boolean
  /** Ленты Хабра в разделе «Тексты». */
  habrFeeds: HabrFeed[]
}
