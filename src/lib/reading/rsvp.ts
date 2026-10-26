/**
 * Разминка RSVP: слова показываются по одному (или 1–3) в фиксированной точке.
 */

/** Опорная буква (ORP): чуть левее середины слова, туда глаз смотрит при узнавании. */
export function orpIndex(word: string): number {
  if (word.length <= 1) return 0
  return Math.min(word.length - 1, Math.max(0, Math.floor((word.length - 1) * 0.35)))
}

/** Слово, разрезанное по опорной букве: левая часть, опорная буква, правая часть. */
export function splitAtOrp(word: string): [string, string, string] {
  const i = orpIndex(word)
  return [word.slice(0, i), word.charAt(i), word.slice(i + 1)]
}

/**
 * Сколько показывать группу слов. Базово — слова / темп; после конца фразы
 * пауза ×1,8, после запятой, точки с запятой, двоеточия или тире — ×1,3.
 */
export function chunkDelayMs(chunk: string[], wpm: number): number {
  if (!chunk.length || wpm <= 0) return 0
  const base = (chunk.length * 60_000) / wpm
  const last = chunk[chunk.length - 1]
  if (/[.!?…]["»”)]?$/.test(last)) return base * 1.8
  if (/[,;:—–]["»”)]?$/.test(last) || last === '—') return base * 1.3
  return base
}
