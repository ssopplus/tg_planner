import { InlineKeyboard } from 'grammy'
import { and, count, desc, eq, gt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { readingCards, readingSessions } from '@/lib/db/schema'
import { miniAppUrl } from '@/lib/telegram/mini-app-url'
import { BUILTIN_TEXTS } from '@/lib/reading/builtin'
import { countDueCards, recordSession, sessionDays } from '@/lib/reading/repo'
import { parseReadingSettings } from '@/lib/reading/settings'
import { dayKey, plural, recommendedPacerWpm, streak } from '@/lib/reading/stats'
import type { ReminderKind } from '@/lib/reading/remind'
import type { ReadingLang, ReadingSettings, ReadingSessionType } from '@/lib/reading/types'

/**
 * «Темп чтения» в чате бота: сводка, напоминание и повторение карточек.
 * Здесь только сборка сообщений и запросы — отправка напоминаний живёт в
 * `reading-remind.ts`, потому что ей нужен сам `bot`, а этот модуль
 * импортируют обработчики бота.
 */

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Карточек за один проход в чате: дальше удобнее в Mini App. */
export const CHAT_REVIEW_LIMIT = 20

/** Callback-данные раздела — префикс `rd:`; Telegram ограничивает их 64 байтами. */
export const READING_CALLBACK_PREFIX = 'rd:'

export interface ReadingSummary {
  settings: ReadingSettings
  today: string
  started: boolean
  trainedToday: boolean
  /** Серия до сегодняшнего дня включительно, если сегодня уже занимались. */
  streak: number
  todayTypes: ReadingSessionType[]
  due: number
  totalCards: number
  lastTests: Partial<Record<ReadingLang, { wpm: number; comp: number | null }>>
  wordOfDay: { en: string; ru: string } | null
}

/** Слово дня: одно и то же весь день — из своих выученных карточек, иначе из глоссариев. */
function pickByDay<T>(items: T[], day: string): T | null {
  if (!items.length) return null
  let hash = 0
  for (const ch of day) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return items[hash % items.length]
}

const BUILTIN_GLOSSARY: { en: string; ru: string }[] = BUILTIN_TEXTS.flatMap((t) =>
  Object.entries(t.glossary ?? {}).map(([en, ru]) => ({ en, ru })),
)

export async function readingSummary(
  userId: string,
  timezone: string,
  rawSettings: unknown,
  now = new Date(),
): Promise<ReadingSummary> {
  const today = dayKey(now, timezone)
  const [days, todaySessions, due, [cardCount], tests, known] = await Promise.all([
    sessionDays(userId),
    db
      .select({ type: readingSessions.type })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), eq(readingSessions.day, today))),
    countDueCards(userId, now),
    db.select({ value: count() }).from(readingCards).where(eq(readingCards.userId, userId)),
    db
      .select({ lang: readingSessions.lang, wpm: readingSessions.wpm, comp: readingSessions.comp })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), eq(readingSessions.type, 'test')))
      .orderBy(desc(readingSessions.createdAt))
      .limit(20),
    db
      .select({ en: readingCards.en, ru: readingCards.ru })
      .from(readingCards)
      .where(and(eq(readingCards.userId, userId), gt(readingCards.box, 0)))
      .limit(200),
  ])

  const lastTests: ReadingSummary['lastTests'] = {}
  for (const t of tests) {
    const lang = t.lang === 'en' ? 'en' : 'ru'
    if (!lastTests[lang] && t.wpm) lastTests[lang] = { wpm: t.wpm, comp: t.comp }
  }

  return {
    settings: parseReadingSettings(rawSettings),
    today,
    started: days.length > 0,
    trainedToday: todaySessions.length > 0,
    streak: streak(days, today),
    todayTypes: todaySessions.map((s) => s.type as ReadingSessionType),
    due,
    totalCards: cardCount?.value ?? 0,
    lastTests,
    wordOfDay: pickByDay(known.length ? known : BUILTIN_GLOSSARY, today),
  }
}

function daysWord(n: number): string {
  return `${n} ${plural(n, 'день', 'дня', 'дней')}`
}

function wordsWord(n: number): string {
  return `${n} ${plural(n, 'слово', 'слова', 'слов')}`
}

function pacerLine(summary: ReadingSummary): string | null {
  const lang = summary.settings.lang
  const test = summary.lastTests[lang]
  if (!test) return 'Начните с теста скорости — от него подберётся темп указки.'
  return `Указка: ${recommendedPacerWpm(test.wpm)} слов/мин (тест — ${test.wpm}${
    test.comp !== null ? `, понимание ${test.comp}%` : ''
  }).`
}

function readingKeyboard(due: number): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  const url = miniAppUrl('/reading')
  if (url) keyboard.webApp('📖 Открыть тренажёр', url)
  if (due)
    keyboard.row().text(`🔁 Повторить ${wordsWord(Math.min(due, CHAT_REVIEW_LIMIT))}`, 'rd:s')
  return keyboard
}

export function reminderMessage(kind: ReminderKind, summary: ReadingSummary) {
  const lines: string[] = []
  if (kind === 'streak') {
    lines.push(
      `🔥 <b>Серия ${daysWord(summary.streak)} сгорит в полночь</b>`,
      'Хватит пяти минут: разминка или карточки.',
    )
  } else {
    lines.push('📖 <b>Время почитать</b>')
    if (summary.streak) lines.push(`Серия: ${daysWord(summary.streak)} — не прерывайте.`)
    lines.push('План ~15 минут: разминка · указка · без голоса · тест.')
    const pacer = pacerLine(summary)
    if (pacer) lines.push(pacer)
  }
  if (summary.due) lines.push(`Карточки: ${wordsWord(summary.due)} к повторению.`)
  if (summary.wordOfDay) {
    lines.push(
      '',
      `Слово дня: <b>${escapeHtml(summary.wordOfDay.en)}</b> — ${escapeHtml(summary.wordOfDay.ru)}`,
    )
  }
  return { text: lines.join('\n'), keyboard: readingKeyboard(summary.due) }
}

const TYPE_LABEL: Record<ReadingSessionType, string> = {
  rsvp: 'разминка',
  pacer: 'указка',
  silent: 'без голоса',
  test: 'тест',
  read_en: 'английский',
  cards: 'карточки',
}

/** Сводка для /read. */
export function statsMessage(summary: ReadingSummary) {
  const lines = ['📖 <b>Темп чтения</b>']
  if (!summary.started) {
    lines.push(
      'Тренировок ещё не было. Откройте тренажёр и начните с теста скорости.',
      '',
      'Текст для тренировки можно прислать сюда: файл .fb2/.epub/.pdf/.txt или ссылку на статью.',
    )
    return { text: lines.join('\n'), keyboard: readingKeyboard(summary.due) }
  }
  lines.push(
    summary.streak
      ? `Серия: ${daysWord(summary.streak)}`
      : 'Серии нет — сегодня хороший день начать',
  )
  const done = Array.from(new Set(summary.todayTypes)).map((t) => TYPE_LABEL[t])
  lines.push(done.length ? `Сегодня: ${done.join(', ')}` : 'Сегодня ещё не занимались')
  for (const lang of ['ru', 'en'] as const) {
    const test = summary.lastTests[lang]
    if (test) {
      lines.push(
        `Тест ${lang.toUpperCase()}: ${test.wpm} слов/мин${test.comp !== null ? `, понимание ${test.comp}%` : ''}`,
      )
    }
  }
  const pacer = pacerLine(summary)
  if (pacer) lines.push(pacer)
  lines.push(
    summary.totalCards
      ? `Карточки: ${summary.totalCards}, к повторению — ${summary.due}`
      : 'Карточек пока нет: слова сохраняются на вкладке «Английский»',
  )
  return { text: lines.join('\n'), keyboard: readingKeyboard(summary.due) }
}

/** Время начала прохода — в callback-данных секундами в base36, чтобы уложиться в 64 байта. */
export function encodeStart(ms: number): string {
  return Math.floor(ms / 1000).toString(36)
}

export function decodeStart(value: string | undefined): number | null {
  if (!value) return null
  const seconds = parseInt(value, 36)
  return Number.isFinite(seconds) ? seconds * 1000 : null
}

interface CardView {
  id: string
  en: string
  ru: string
  ctx: string
}

/** Слово в контексте, само слово — жирным. */
function contextLine(card: CardView): string | null {
  if (!card.ctx) return null
  const escaped = escapeHtml(card.ctx)
  const pattern = new RegExp(`\\b(${card.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*)`, 'i')
  return `<i>${escaped.replace(pattern, '<b>$1</b>')}</i>`
}

export function reviewFront(card: CardView, done: number, start: string, due: number) {
  const lines = [
    `🔁 Карточка ${done + 1} из ${Math.min(done + due, CHAT_REVIEW_LIMIT)}`,
    '',
    `<b>${escapeHtml(card.en)}</b>`,
  ]
  const ctx = contextLine(card)
  if (ctx) lines.push('', ctx)
  const keyboard = new InlineKeyboard()
    .text('Показать перевод', `rd:a:${card.id}:${done}:${start}`)
    .row()
    .text('Хватит', `rd:x:${done}:${start}`)
  return { text: lines.join('\n'), keyboard }
}

export function reviewBack(card: CardView, done: number, start: string, due: number) {
  const front = reviewFront(card, done, start, due)
  const text = `${front.text}\n\n→ ${escapeHtml(card.ru)}`
  const keyboard = new InlineKeyboard()
    .text('Не помню', `rd:g:${card.id}:0:${done}:${start}`)
    .text('С трудом', `rd:g:${card.id}:1:${done}:${start}`)
    .text('Помню', `rd:g:${card.id}:2:${done}:${start}`)
  return { text, keyboard }
}

/** Конец прохода: тренировка «карточки» попадает в статистику, как из Mini App. */
export async function finishReview(
  userId: string,
  timezone: string,
  done: number,
  startMs: number | null,
  now = new Date(),
) {
  if (done > 0) {
    const ms = startMs ? Math.min(Math.max(0, now.getTime() - startMs), 3_600_000) : null
    await recordSession(userId, {
      type: 'cards',
      lang: 'en',
      day: dayKey(now, timezone),
      wpm: null,
      comp: null,
      ms,
      textId: null,
      title: 'Повторение в чате',
      cardsReviewed: done,
      wordsSaved: null,
    })
  }
  const due = await countDueCards(userId, now)
  const lines = [
    done ? `✅ Повторено: ${wordsWord(done)}` : 'Повторение остановлено',
    due ? `Осталось к повторению: ${due}` : 'На сегодня всё повторено',
  ]
  const keyboard = new InlineKeyboard()
  if (due) keyboard.text('Ещё', 'rd:s')
  const url = miniAppUrl('/reading')
  if (url) keyboard.webApp('📖 Открыть тренажёр', url)
  return { text: lines.join('\n'), keyboard }
}
