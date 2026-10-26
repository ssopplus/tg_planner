import { describe, expect, it } from 'vitest'
import { BUILTIN_TEXTS } from './builtin'
import { chunkText, PART_MAX_WORDS, PART_MIN_WORDS } from './chunk'
import { buildSavedSet, glossLookup, normalizeSurface, sentenceAround } from './glossary'
import { estimateLevel } from './level'
import { groupLines, lineDurationMs } from './lines'
import { chunkDelayMs, orpIndex, splitAtOrp } from './rsvp'
import { AGAIN_DELAY_MS, DAY_MS, dueQueue, gradeCard } from './srs'
import {
  computeWpm,
  dailyPlan,
  dailyTip,
  effectiveWpm,
  formatDuration,
  nextPacerWpm,
  plural,
  recommendedPacerWpm,
  shiftDay,
  streak,
} from './stats'
import { countWords } from './text-utils'

describe('WPM и рекомендации', () => {
  it('считает слова в минуту', () => {
    expect(computeWpm(300, 60_000)).toBe(300)
    expect(computeWpm(250, 75_000)).toBe(200)
    expect(computeWpm(100, 500)).toBe(0)
  })

  it('эффективная скорость = темп × понимание', () => {
    expect(effectiveWpm(300, 75)).toBe(225)
  })

  it('указка на 15% быстрее теста, округление до 10', () => {
    expect(recommendedPacerWpm(240)).toBe(280)
    expect(recommendedPacerWpm(213)).toBe(240)
  })

  it('после текста указки предлагается +10%', () => {
    expect(nextPacerWpm(260)).toBe(290)
  })

  it('подсказка дня по правилам ТЗ', () => {
    expect(dailyTip({ lang: 'ru', last: null, planDone: false })).toMatch(/^Начните с теста/)
    expect(dailyTip({ lang: 'en', last: null, planDone: false })).toMatch(/^Английский режим/)
    expect(dailyTip({ lang: 'ru', last: { wpm: 300, comp: 50 }, planDone: false })).toMatch(
      /Понимание 50%/,
    )
    expect(dailyTip({ lang: 'ru', last: { wpm: 240, comp: 80 }, planDone: false })).toMatch(/280/)
    expect(dailyTip({ lang: 'ru', last: { wpm: 240, comp: 80 }, planDone: true })).toMatch(
      /выполнен/,
    )
  })

  it('план дня: шесть пунктов, карточки с числом слов', () => {
    const plan = dailyPlan(3, 10)
    expect(plan.map((p) => p.type)).toEqual(['rsvp', 'pacer', 'silent', 'test', 'cards', 'read_en'])
    expect(plan[4].hint).toBe('3 слова к повторению')
    expect(dailyPlan(0, 0)[4].hint).toMatch(/Английский/)
  })
})

describe('серия дней', () => {
  it('сдвигает день через границу месяца и года', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('считает от сегодня, если сегодня занимались', () => {
    expect(streak(['2026-10-24', '2026-10-25', '2026-10-26'], '2026-10-26')).toBe(3)
  })

  it('если сегодня ещё не занимались — от вчера', () => {
    expect(streak(['2026-10-24', '2026-10-25'], '2026-10-26')).toBe(2)
  })

  it('пропуск обрывает серию', () => {
    expect(streak(['2026-10-22', '2026-10-24'], '2026-10-26')).toBe(0)
  })
})

describe('интервальные повторения', () => {
  const now = 1_000_000_000_000

  it('«Не помню» — box 0 и повтор через 10 минут', () => {
    expect(gradeCard(4, 0, now)).toEqual({ box: 0, dueAt: now + AGAIN_DELAY_MS })
  })

  it('«С трудом» — box прежний, половина интервала, минимум день', () => {
    expect(gradeCard(0, 1, now)).toEqual({ box: 0, dueAt: now + DAY_MS })
    expect(gradeCard(4, 1, now)).toEqual({ box: 4, dueAt: now + 7 * DAY_MS })
  })

  it('«Помню» — box +1 и интервал новой ступени, не выше 120 дней', () => {
    expect(gradeCard(0, 2, now)).toEqual({ box: 1, dueAt: now + DAY_MS })
    expect(gradeCard(3, 2, now)).toEqual({ box: 4, dueAt: now + 14 * DAY_MS })
    expect(gradeCard(7, 2, now)).toEqual({ box: 7, dueAt: now + 120 * DAY_MS })
  })

  it('очередь — только наступившие, по возрастанию срока', () => {
    const cards = [
      { id: 'b', dueAt: now - 10 },
      { id: 'c', dueAt: now + 10 },
      { id: 'a', dueAt: now - 100 },
    ]
    expect(dueQueue(cards, now).map((c) => c.id)).toEqual(['a', 'b'])
  })
})

describe('разминка RSVP', () => {
  it('опорная буква — floor((len-1)·0,35)', () => {
    expect(orpIndex('a')).toBe(0)
    expect(orpIndex('чтение')).toBe(1)
    expect(orpIndex('переключатель')).toBe(4)
    expect(splitAtOrp('чтение')).toEqual(['ч', 'т', 'ение'])
  })

  it('паузы после знаков препинания', () => {
    expect(chunkDelayMs(['слово'], 300)).toBe(200)
    expect(chunkDelayMs(['конец.'], 300)).toBe(360)
    expect(chunkDelayMs(['запятая,'], 300)).toBe(260)
    expect(chunkDelayMs(['два', 'слова'], 300)).toBe(400)
  })
})

describe('строки указки', () => {
  it('группирует слова по offsetTop с допуском', () => {
    const lines = groupLines([
      { top: 0, left: 0, width: 30, height: 20 },
      { top: 2, left: 40, width: 30, height: 22 },
      { top: 30, left: 0, width: 50, height: 20 },
    ])
    expect(lines).toEqual([
      { top: 0, height: 22, left: 0, right: 70, words: [0, 1] },
      { top: 30, height: 20, left: 0, right: 50, words: [2] },
    ])
  })

  it('время на строку = слова / темп', () => {
    expect(lineDurationMs(10, 300)).toBe(2000)
  })
})

describe('перевод по клику', () => {
  const glossary = { store: 'хранить', study: 'изучать', stop: 'остановиться', make: 'делать' }

  it('нормализует словоформу', () => {
    expect(normalizeSurface('“Don’t,')).toBe("don't")
    expect(normalizeSurface('—')).toBe('')
  })

  it('находит словарную форму, отсекая окончания', () => {
    expect(glossLookup('store', glossary)).toEqual({ base: 'store', ru: 'хранить' })
    expect(glossLookup('stored', glossary)?.base).toBe('store')
    expect(glossLookup('studies', glossary)?.base).toBe('study')
    expect(glossLookup('studied', glossary)?.base).toBe('study')
    expect(glossLookup('making', glossary)?.base).toBe('make')
    expect(glossLookup('stopped', glossary)?.base).toBe('stop')
    expect(glossLookup('unknown', glossary)).toBeNull()
  })

  it('берёт предложение вокруг слова', () => {
    const words = 'First one. Second sentence here! Third.'.split(' ')
    expect(sentenceAround(words, 3)).toBe('Second sentence here!')
    expect(sentenceAround(words, 0)).toBe('First one.')
  })

  it('сохранённые слова — по словарной форме и словоформам', () => {
    const set = buildSavedSet([{ en: 'store', forms: ['stored'] }])
    expect(set.has('stored')).toBe(true)
    expect(set.has('store')).toBe(true)
  })
})

describe('уровень английского текста', () => {
  it('совпадает с разметкой встроенных текстов', () => {
    for (const text of BUILTIN_TEXTS.filter((t) => t.lang === 'en')) {
      expect(estimateLevel(text.body), text.id).toBe(text.level)
    }
  })
})

describe('нарезка на части', () => {
  const paragraph = (n: number) => Array.from({ length: n }, () => 'слово').join(' ') + '.'

  it('короткий текст — одна часть', () => {
    expect(chunkText(paragraph(300)).parts).toHaveLength(1)
  })

  it('режет по абзацам в пределах 400–800 слов', () => {
    const text = Array.from({ length: 10 }, () => paragraph(250)).join('\n\n')
    const { parts } = chunkText(text)
    for (const part of parts) {
      expect(countWords(part)).toBeGreaterThanOrEqual(PART_MIN_WORDS)
      expect(countWords(part)).toBeLessThanOrEqual(PART_MAX_WORDS)
    }
    expect(parts.reduce((sum, p) => sum + countWords(p), 0)).toBe(2500)
  })

  it('огромный абзац без переносов режется по предложениям', () => {
    const text = Array.from({ length: 30 }, () => paragraph(90)).join(' ')
    const { parts } = chunkText(text)
    expect(parts.length).toBeGreaterThan(2)
    for (const part of parts) expect(countWords(part)).toBeLessThanOrEqual(PART_MAX_WORDS)
  })
})

describe('форматирование', () => {
  it('склонение и длительность', () => {
    expect(plural(1, 'слово', 'слова', 'слов')).toBe('слово')
    expect(plural(3, 'слово', 'слова', 'слов')).toBe('слова')
    expect(plural(11, 'слово', 'слова', 'слов')).toBe('слов')
    expect(formatDuration(75_000)).toBe('1:15')
  })
})
