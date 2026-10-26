import type { ReadingLang, ReadingSession, ReadingSessionType } from './types'

/** Порог понимания из ТЗ: ниже — скорость не засчитывается как прогресс, темп надо снижать. */
export const COMPREHENSION_THRESHOLD = 70

/** Указка ставится на 15% быстрее последнего теста. */
export const PACER_BOOST = 1.15

/** Локальная дата YYYY-MM-DD. На клиенте — по часам устройства, на сервере — по часовому поясу. */
export function dayKey(date: Date, timeZone?: string): string {
  if (timeZone) return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** День YYYY-MM-DD, сдвинутый на `delta` суток. Считаем в UTC, чтобы не мешал переход на летнее время. */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + delta))
  return date.toISOString().slice(0, 10)
}

/**
 * Серия дней подряд. День засчитывается за любую тренировку; если сегодня
 * ещё не занимались, серия считается от вчера — она не сгорела, пока не
 * кончился день.
 */
export function streak(days: Iterable<string>, today: string): number {
  const set = new Set(days)
  let cursor = set.has(today) ? today : shiftDay(today, -1)
  let n = 0
  while (set.has(cursor)) {
    n++
    cursor = shiftDay(cursor, -1)
  }
  return n
}

/** Слова в минуту. Меньше секунды чтения — замера нет. */
export function computeWpm(words: number, ms: number): number {
  if (ms < 1000 || words <= 0) return 0
  return Math.round(words / (ms / 60000))
}

/** Эффективная скорость = темп × понимание. */
export function effectiveWpm(wpm: number, comp: number): number {
  return Math.round((wpm * comp) / 100)
}

export function roundTo10(value: number): number {
  return Math.round(value / 10) * 10
}

export function recommendedPacerWpm(lastTestWpm: number): number {
  return roundTo10(lastTestWpm * PACER_BOOST)
}

/** Следующий темп указки после пройденного текста: +10%. */
export function nextPacerWpm(wpm: number): number {
  return wpm + roundTo10(wpm * 0.1)
}

export interface PlanItem {
  type: ReadingSessionType
  title: string
  hint: string
  /** Раздел, куда ведёт кнопка. */
  section: string
}

export const BASE_PLAN: PlanItem[] = [
  {
    type: 'rsvp',
    title: 'Разминка: слова по одному',
    hint: '2 минуты. Разгоняет темп восприятия',
    section: 'rsvp',
  },
  { type: 'pacer', title: 'Указка', hint: '5 минут. Ритм без возвратов назад', section: 'pacer' },
  {
    type: 'silent',
    title: 'Чтение без голоса',
    hint: '5 минут. Счёт про себя глушит проговаривание',
    section: 'silent',
  },
  {
    type: 'test',
    title: 'Тест скорости',
    hint: '3 минуты. Замер темпа и понимания',
    section: 'test',
  },
]

/** Полный план дня: четыре упражнения на скорость, карточки и чтение на английском. */
export function dailyPlan(dueCount: number, totalCards: number): PlanItem[] {
  const cardsHint = dueCount
    ? `${dueCount} ${plural(dueCount, 'слово', 'слова', 'слов')} к повторению`
    : totalCards
      ? 'На сегодня всё повторено'
      : 'Добавляйте слова на вкладке «Английский»'
  return [
    ...BASE_PLAN,
    { type: 'cards', title: 'Карточки слов', hint: cardsHint, section: 'cards' },
    {
      type: 'read_en',
      title: 'Текст на английском',
      hint: '10 минут. Читайте и сохраняйте новые слова',
      section: 'english',
    },
  ]
}

/** Последний тест скорости на языке тренировок. */
export function lastTest(sessions: ReadingSession[], lang: ReadingLang): ReadingSession | null {
  let last: ReadingSession | null = null
  for (const s of sessions) {
    if (s.type === 'test' && s.lang === lang && (!last || s.createdAt > last.createdAt)) last = s
  }
  return last
}

/** Подсказка под планом дня — правила из ТЗ. */
export function dailyTip(input: {
  lang: ReadingLang
  last: Pick<ReadingSession, 'wpm' | 'comp'> | null
  planDone: boolean
}): string {
  const { last } = input
  if (!last?.wpm) {
    return `${input.lang === 'en' ? 'Английский режим: ' : ''}Начните с теста скорости: он покажет исходный темп, и от него подберётся скорость указки.`
  }
  const comp = last.comp ?? 0
  if (comp < COMPREHENSION_THRESHOLD) {
    return `Понимание ${comp}%: это ниже ${COMPREHENSION_THRESHOLD}%. Сбавьте темп указки на 10–15% и закрепитесь на нём.`
  }
  if (input.planDone) {
    return 'План на сегодня выполнен. Завтра попробуйте указку на 10 слов/мин быстрее.'
  }
  return `Указку ставьте на ${recommendedPacerWpm(last.wpm)} слов/мин: это на 15% быстрее вашего последнего теста.`
}

/** Русское склонение по числу: 1 слово, 2 слова, 5 слов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m = n % 10
  const h = n % 100
  if (m === 1 && h !== 11) return one
  if (m >= 2 && m <= 4 && (h < 10 || h >= 20)) return few
  return many
}

/** 75 000 мс → «1:15». */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Минимальная длительность, с которой тренировка записывается (из ТЗ). */
export const MIN_SESSION_MS: Partial<Record<ReadingSessionType, number>> = {
  rsvp: 20_000,
  pacer: 30_000,
  silent: 60_000,
}
