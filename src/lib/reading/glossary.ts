/**
 * Перевод слова по клику: словоформа → словарная форма через глоссарий текста
 * с отсечением окончаний, контекст — предложение вокруг слова.
 */

/** Словоформа для поиска: нижний регистр, только буквы, апостроф и дефис внутри слова. */
export function normalizeSurface(token: string): string {
  return token
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z'-]/g, '')
    .replace(/^['-]+|['-]+$/g, '')
}

/** Окончания и что подставить вместо них: studies → study, stored → store, making → make. */
const SUFFIXES: Array<[string, string]> = [
  ['ies', 'y'],
  ['es', ''],
  ['s', ''],
  ['ied', 'y'],
  ['ed', ''],
  ['ed', 'e'],
  ['ing', ''],
  ['ing', 'e'],
  ['ly', ''],
]

export interface GlossHit {
  base: string
  ru: string
}

export function glossLookup(
  surface: string,
  glossary: Record<string, string> | null | undefined,
): GlossHit | null {
  if (!glossary || !surface) return null
  if (glossary[surface]) return { base: surface, ru: glossary[surface] }
  for (const [suffix, add] of SUFFIXES) {
    if (surface.length > suffix.length + 1 && surface.endsWith(suffix)) {
      const base = surface.slice(0, -suffix.length) + add
      if (glossary[base]) return { base, ru: glossary[base] }
    }
  }
  // Удвоенная согласная: stopped → stop, running → run.
  const doubled = /^(.*?)([b-df-hj-np-tv-z])\2(ed|ing)$/.exec(surface)
  if (doubled) {
    const base = doubled[1] + doubled[2]
    if (glossary[base]) return { base, ru: glossary[base] }
  }
  return null
}

const SENTENCE_END = /[.!?…]["»”)]?$/

/** Предложение, в котором стоит слово с индексом `index` (слова — токены абзаца). */
export function sentenceAround(words: string[], index: number): string {
  let start = index
  while (start > 0 && !SENTENCE_END.test(words[start - 1])) start--
  let end = index
  while (end < words.length - 1 && !SENTENCE_END.test(words[end])) end++
  return words.slice(start, end + 1).join(' ')
}

/** Сохранено ли слово в карточках — по словарной форме или по встреченной словоформе. */
export function buildSavedSet(cards: { en: string; forms: string[] }[]): Set<string> {
  const set = new Set<string>()
  for (const card of cards) {
    set.add(card.en.toLowerCase())
    for (const form of card.forms) set.add(form.toLowerCase())
  }
  return set
}
