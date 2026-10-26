import { countWords, normalizeText, splitWords } from './text-utils'

/**
 * Нарезка длинного текста на части для тренировок: 400–800 слов, по границам
 * абзацев. Часть короче минимума доклеивается к предыдущей; абзац длиннее
 * максимума режется по предложениям.
 */

export const PART_MIN_WORDS = 400
export const PART_MAX_WORDS = 800
/** Книга на 300 частей — это 200 тысяч слов; дальше режем, чтобы не плодить строки. */
export const MAX_PARTS = 300

function splitLongParagraph(paragraph: string): string[] {
  if (countWords(paragraph) <= PART_MAX_WORDS) return [paragraph]
  const sentences = paragraph.match(/[^.!?…]+[.!?…]+["»”)]?\s*|[^.!?…]+$/g) ?? [paragraph]
  const out: string[] = []
  let buf: string[] = []
  let words = 0
  for (const sentence of sentences) {
    const n = countWords(sentence)
    if (words + n > PART_MAX_WORDS && buf.length) {
      out.push(buf.join('').trim())
      buf = []
      words = 0
    }
    // Предложение длиннее части (таблица, код без точек) режем по словам.
    if (n > PART_MAX_WORDS) {
      const tokens = splitWords(sentence)
      for (let i = 0; i < tokens.length; i += PART_MAX_WORDS) {
        out.push(tokens.slice(i, i + PART_MAX_WORDS).join(' '))
      }
      continue
    }
    buf.push(sentence)
    words += n
  }
  if (buf.length) out.push(buf.join('').trim())
  return out.filter(Boolean)
}

export function chunkText(text: string): { parts: string[]; truncated: boolean } {
  const paragraphs = normalizeText(text).split('\n\n').flatMap(splitLongParagraph)
  // Целевой размер части — поровну на минимальное число частей. Иначе
  // жадная нарезка по максимуму оставляет короткий хвост: 750, 750, 750, 250.
  const total = paragraphs.reduce((sum, p) => sum + countWords(p), 0)
  const target = total / Math.max(1, Math.ceil(total / PART_MAX_WORDS))
  const parts: string[][] = []
  let current: string[] = []
  let words = 0
  for (const paragraph of paragraphs) {
    const n = countWords(paragraph)
    if (words >= PART_MIN_WORDS && words + n > target) {
      parts.push(current)
      current = []
      words = 0
    }
    current.push(paragraph)
    words += n
  }
  if (current.length) {
    // Короткий хвост уходит в предыдущую часть, если та от этого не раздуется вдвое.
    if (parts.length && words < PART_MIN_WORDS / 2) parts[parts.length - 1].push(...current)
    else parts.push(current)
  }
  const joined = parts.map((p) => p.join('\n\n'))
  return { parts: joined.slice(0, MAX_PARTS), truncated: joined.length > MAX_PARTS }
}
