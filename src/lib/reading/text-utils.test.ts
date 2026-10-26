import { describe, expect, it } from 'vitest'
import {
  countWords,
  MIN_CUSTOM_WORDS,
  normalizeText,
  splitParagraphs,
  validateCustomText,
} from './text-utils'

const longBody = (n: number) => Array.from({ length: n }, (_, i) => `слово${i}`).join(' ')

describe('countWords', () => {
  it('считает слова через любые пробельные символы', () => {
    expect(countWords('  раз два\tтри\n\nчетыре  ')).toBe(4)
  })

  it('пустой текст — ноль слов', () => {
    expect(countWords('   ')).toBe(0)
  })
})

describe('normalizeText', () => {
  it('склеивает переносы внутри абзаца и оставляет одну пустую строку между абзацами', () => {
    const raw = 'Первая строка\r\nвторая строка\r\n\r\n\r\n  Новый   абзац  \n'
    expect(normalizeText(raw)).toBe('Первая строка вторая строка\n\nНовый абзац')
  })

  it('разбивает текст на абзацы', () => {
    expect(splitParagraphs('a\n\n\nb\n \nc')).toEqual(['a', 'b', 'c'])
  })
})

describe('validateCustomText', () => {
  it('принимает текст от минимума слов и нормализует его', () => {
    const result = validateCustomText({
      lang: 'en',
      title: '  Title ',
      body: longBody(MIN_CUSTOM_WORDS),
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.title).toBe('Title')
      expect(result.value.wordCount).toBe(MIN_CUSTOM_WORDS)
    }
  })

  it('отклоняет короткий текст с числом слов в ошибке', () => {
    const result = validateCustomText({ lang: 'ru', title: 'T', body: longBody(10) })
    expect(result).toEqual({
      ok: false,
      error: `В тексте 10 слов, нужно не меньше ${MIN_CUSTOM_WORDS}`,
    })
  })

  it('отклоняет неизвестный язык и пустое название', () => {
    expect(validateCustomText({ lang: 'de', title: 'T', body: longBody(100) }).ok).toBe(false)
    expect(validateCustomText({ lang: 'ru', title: '  ', body: longBody(100) }).ok).toBe(false)
  })
})
