import type { CefrLevel } from './types'
import { splitWords } from './text-utils'

/**
 * Грубая оценка уровня английского текста без словаря частотности: индекс
 * удобочитаемости Флеша (длина предложений и слогов). Точнее уровень ставит
 * LLM при генерации вопросов — эта оценка нужна, чтобы фильтр B1/B2 работал
 * сразу после загрузки.
 */

/** Слоги английского слова по группам гласных — с поправкой на немую «e» на конце. */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 0
  if (w.length <= 3) return 1
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '')
  const groups = trimmed.match(/[aeiouy]{1,2}/g)
  return Math.max(1, groups?.length ?? 1)
}

export function fleschReadingEase(text: string): number {
  const words = splitWords(text).filter((w) => /[a-z]/i.test(w))
  if (!words.length) return 100
  const sentences = Math.max(1, (text.match(/[.!?…]+(?=\s|$)/g) ?? []).length)
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0)
  return 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length)
}

/** Пороги подобраны по встроенным текстам: их B1 и B2 должны распознаваться как размечены. */
export function estimateLevel(text: string): CefrLevel {
  const ease = fleschReadingEase(text)
  if (ease >= 65) return 'B1'
  if (ease >= 45) return 'B2'
  return 'C1'
}
