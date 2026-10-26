import { describe, expect, it } from 'vitest'
import { DEFAULT_READING_SETTINGS, parseReadingSettings } from './settings'

describe('parseReadingSettings', () => {
  it('без сохранённых настроек отдаёт значения по умолчанию', () => {
    expect(parseReadingSettings(undefined)).toEqual(DEFAULT_READING_SETTINGS)
    expect(parseReadingSettings('мусор')).toEqual(DEFAULT_READING_SETTINGS)
  })

  it('сохраняет корректные поля', () => {
    const saved = {
      lang: 'en',
      pacerWpm: 310,
      rsvpWpm: 450,
      rsvpChunk: 2,
      silentBpm: 120,
      lastText: { ru: 'b2', en: 'e4' },
    }
    expect(parseReadingSettings(saved)).toEqual(saved)
  })

  it('прижимает темп к диапазону ползунка и чинит битые поля по одному', () => {
    const parsed = parseReadingSettings({
      lang: 'de',
      pacerWpm: 5000,
      rsvpWpm: 10,
      rsvpChunk: 7,
      silentBpm: 'быстро',
      lastText: { ru: 42, en: 'e1' },
    })
    expect(parsed).toEqual({
      lang: 'ru',
      pacerWpm: 800,
      rsvpWpm: 150,
      rsvpChunk: 1,
      silentBpm: DEFAULT_READING_SETTINGS.silentBpm,
      lastText: { ru: null, en: 'e1' },
    })
  })
})
