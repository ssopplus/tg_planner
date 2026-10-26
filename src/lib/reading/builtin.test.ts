import { describe, expect, it } from 'vitest'
import { BUILTIN_TEXTS, FUNCTION_WORDS } from './builtin'
import { MIN_CUSTOM_WORDS } from './text-utils'

describe('встроенные тексты', () => {
  it('по пять текстов на каждом языке, id не повторяются', () => {
    expect(BUILTIN_TEXTS.filter((t) => t.lang === 'ru')).toHaveLength(5)
    expect(BUILTIN_TEXTS.filter((t) => t.lang === 'en')).toHaveLength(5)
    expect(new Set(BUILTIN_TEXTS.map((t) => t.id)).size).toBe(BUILTIN_TEXTS.length)
  })

  it('каждый текст годится для теста: хватает слов и у вопросов есть верный вариант', () => {
    for (const text of BUILTIN_TEXTS) {
      expect(text.wordCount, text.id).toBeGreaterThanOrEqual(MIN_CUSTOM_WORDS)
      expect(text.questions?.length, text.id).toBe(4)
      for (const q of text.questions ?? []) {
        expect(q.answer, `${text.id}: ${q.q}`).toBeGreaterThanOrEqual(0)
        expect(q.answer, `${text.id}: ${q.q}`).toBeLessThan(q.options.length)
      }
    }
  })

  it('у английских текстов есть уровень и глоссарий', () => {
    for (const text of BUILTIN_TEXTS.filter((t) => t.lang === 'en')) {
      expect(['B1', 'B2', 'C1'], text.id).toContain(text.level)
      expect(Object.keys(text.glossary ?? {}).length, text.id).toBeGreaterThan(0)
    }
  })

  it('служебные слова есть для обоих языков', () => {
    expect(FUNCTION_WORDS.ru.has('и')).toBe(true)
    expect(FUNCTION_WORDS.en.has('the')).toBe(true)
  })
})
