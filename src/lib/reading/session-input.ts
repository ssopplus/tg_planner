import type { ReadingLang, ReadingSessionType } from './types'

const SESSION_TYPES: ReadingSessionType[] = ['rsvp', 'pacer', 'silent', 'test', 'read_en', 'cards']

export interface SessionInput {
  type: ReadingSessionType
  lang: ReadingLang
  day: string
  wpm: number | null
  comp: number | null
  ms: number | null
  textId: string | null
  title: string | null
  cardsReviewed: number | null
  wordsSaved: number | null
}

function intOrNull(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, Math.round(value)))
}

function strOrNull(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

/**
 * Проверка тренировки от клиента. `day` присылает клиент — это его локальная
 * дата, по ней считаются серия и план дня; сервер её только проверяет на формат.
 */
export function parseSessionInput(
  raw: unknown,
): { ok: true; value: SessionInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Пустая тренировка' }
  const r = raw as Record<string, unknown>
  if (!SESSION_TYPES.includes(r.type as ReadingSessionType)) {
    return { ok: false, error: 'Неизвестный тип тренировки' }
  }
  if (r.lang !== 'ru' && r.lang !== 'en') return { ok: false, error: 'Язык — ru или en' }
  if (typeof r.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.day)) {
    return { ok: false, error: 'День в формате YYYY-MM-DD' }
  }
  return {
    ok: true,
    value: {
      type: r.type as ReadingSessionType,
      lang: r.lang,
      day: r.day,
      wpm: intOrNull(r.wpm, 0, 5000),
      comp: intOrNull(r.comp, 0, 100),
      ms: intOrNull(r.ms, 0, 24 * 3_600_000),
      textId: strOrNull(r.textId, 64),
      title: strOrNull(r.title, 300),
      cardsReviewed: intOrNull(r.cardsReviewed, 0, 10_000),
      wordsSaved: intOrNull(r.wordsSaved, 0, 10_000),
    },
  }
}
