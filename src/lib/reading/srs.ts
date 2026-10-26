import type { CardGrade } from './types'

export const DAY_MS = 86_400_000

/** Интервалы ступеней Лейтнера в днях: box 0…7. */
export const SRS_INTERVALS = [0, 1, 3, 7, 14, 30, 60, 120] as const

/** «Не помню» возвращает карточку в ту же сессию через 10 минут. */
export const AGAIN_DELAY_MS = 10 * 60_000

export interface SrsState {
  box: number
  dueAt: number
}

/**
 * Следующее состояние карточки после оценки:
 * - «Не помню» — box 0, повтор через 10 минут;
 * - «С трудом» — box без изменений, через max(1, интервал/2) дней;
 * - «Помню» — box +1, через интервал новой ступени.
 */
export function gradeCard(box: number, grade: CardGrade, now: number): SrsState {
  const current = Math.min(Math.max(0, Math.trunc(box)), SRS_INTERVALS.length - 1)
  if (grade === 0) return { box: 0, dueAt: now + AGAIN_DELAY_MS }
  if (grade === 1) {
    const days = Math.max(1, Math.round(SRS_INTERVALS[current] / 2))
    return { box: current, dueAt: now + days * DAY_MS }
  }
  const next = Math.min(SRS_INTERVALS.length - 1, current + 1)
  return { box: next, dueAt: now + SRS_INTERVALS[next] * DAY_MS }
}

/** Очередь повторения: карточки, чей срок наступил, самые давние первыми. */
export function dueQueue<T extends { dueAt: string | number | Date }>(
  cards: T[],
  now: number,
): T[] {
  return cards
    .filter((c) => new Date(c.dueAt).getTime() <= now)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
}
