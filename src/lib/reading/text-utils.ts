import type { ReadingLang } from './types'

/** Меньше этого в своём тексте нечего мерить: тест скорости даёт шум, а не темп. */
export const MIN_CUSTOM_WORDS = 80

/** Слова текста: всё, что разделено пробельными символами. Так же считает ТЗ для WPM. */
export function splitWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

export function countWords(text: string): number {
  return splitWords(text).length
}

/**
 * Приводит вставленный текст к виду, в котором его ждут упражнения: переводы
 * строк LF, абзацы через одну пустую строку, без пробелов по краям строк.
 * Одиночный перенос внутри абзаца (так приходит текст из PDF и из почты)
 * склеивается пробелом.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/[ \t]+/g, ' '),
    )
    .filter(Boolean)
    .join('\n\n')
}

export function splitParagraphs(text: string): string[] {
  return normalizeText(text).split('\n\n').filter(Boolean)
}

export interface CustomTextInput {
  lang?: unknown
  title?: unknown
  body?: unknown
}

export type CustomTextValidation =
  | { ok: true; value: { lang: ReadingLang; title: string; body: string; wordCount: number } }
  | { ok: false; error: string }

/** Проверка своего текста — общая для формы в Mini App и для API. */
export function validateCustomText(input: CustomTextInput): CustomTextValidation {
  if (input.lang !== 'ru' && input.lang !== 'en') {
    return { ok: false, error: 'Язык текста — ru или en' }
  }
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) return { ok: false, error: 'Нужно название' }

  const body = typeof input.body === 'string' ? normalizeText(input.body) : ''
  const wordCount = countWords(body)
  if (wordCount < MIN_CUSTOM_WORDS) {
    return {
      ok: false,
      error: `В тексте ${wordCount} слов, нужно не меньше ${MIN_CUSTOM_WORDS}`,
    }
  }
  return { ok: true, value: { lang: input.lang, title, body, wordCount } }
}
