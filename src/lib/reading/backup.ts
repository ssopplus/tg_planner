import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { readingCards, readingSessions, readingTexts, users } from '@/lib/db/schema'
import { cardColumns, loadCards, sessionColumns } from './repo'
import { parseSessionInput } from './session-input'
import { countWords } from './text-utils'

/**
 * Резервная копия тренажёра: свои тексты, тренировки, карточки и настройки
 * одним JSON. Восстановление сливает копию с тем, что уже есть, а не
 * затирает: повторный импорт той же копии ничего не дублирует.
 */

export const BACKUP_APP = 'tempo-reading'
export const BACKUP_VERSION = 1

export async function buildBackup(userId: string) {
  const [texts, sessions, cards, [user]] = await Promise.all([
    db
      .select({
        lang: readingTexts.lang,
        level: readingTexts.level,
        title: readingTexts.title,
        body: readingTexts.body,
        source: readingTexts.source,
        sourceUrl: readingTexts.sourceUrl,
        collection: readingTexts.collection,
        part: readingTexts.part,
        parts: readingTexts.parts,
        glossary: readingTexts.glossary,
        questions: readingTexts.questions,
        createdAt: readingTexts.createdAt,
      })
      .from(readingTexts)
      .where(eq(readingTexts.userId, userId)),
    db.select(sessionColumns).from(readingSessions).where(eq(readingSessions.userId, userId)),
    db.select(cardColumns).from(readingCards).where(eq(readingCards.userId, userId)),
    db.select({ settings: users.settings }).from(users).where(eq(users.id, userId)).limit(1),
  ])
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: (user?.settings as Record<string, unknown> | undefined)?.reading ?? null,
    texts,
    sessions,
    cards,
  }
}

/** Карточки для Anki: TSV с заголовком-директивами, поля «слово · перевод · контекст». */
export async function buildAnkiTsv(userId: string): Promise<string> {
  const cards = await loadCards(userId)
  const field = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim()
  const lines = cards.map((c) => [c.en, c.ru, c.ctx].map(field).join('\t'))
  return (
    ['#separator:tab', '#html:false', '#columns:Front\tBack\tContext', ...lines].join('\n') + '\n'
  )
}

export interface RestoreResult {
  texts: number
  sessions: number
  cards: number
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((v) => v && typeof v === 'object') : []
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

export async function restoreBackup(userId: string, raw: unknown): Promise<RestoreResult> {
  if (!raw || typeof raw !== 'object' || (raw as { app?: unknown }).app !== BACKUP_APP) {
    throw new Error('Это не резервная копия «Темпа чтения»')
  }
  const backup = raw as Record<string, unknown>
  const result: RestoreResult = { texts: 0, sessions: 0, cards: 0 }

  // Тексты: дубль — та же ссылка и часть или то же название с тем же числом слов.
  const existingTexts = await db
    .select({
      sourceUrl: readingTexts.sourceUrl,
      part: readingTexts.part,
      title: readingTexts.title,
      wordCount: readingTexts.wordCount,
    })
    .from(readingTexts)
    .where(eq(readingTexts.userId, userId))
  const textKeys = new Set(
    existingTexts.map((t) =>
      t.sourceUrl ? `${t.sourceUrl}#${t.part}` : `${t.title}#${t.wordCount}`,
    ),
  )
  for (const t of asArray(backup.texts)) {
    const body = str(t.body, 2_000_000)
    const title = str(t.title, 300)
    const lang = t.lang === 'en' ? 'en' : 'ru'
    if (!body || !title) continue
    const wordCount = countWords(body)
    const sourceUrl = str(t.sourceUrl, 2000) || null
    const part = typeof t.part === 'number' ? t.part : null
    const key = sourceUrl ? `${sourceUrl}#${part}` : `${title}#${wordCount}`
    if (textKeys.has(key)) continue
    textKeys.add(key)
    await db.insert(readingTexts).values({
      userId,
      lang,
      level: t.level === 'B1' || t.level === 'B2' || t.level === 'C1' ? t.level : null,
      title,
      body,
      wordCount,
      source: str(t.source, 20) || 'paste',
      sourceUrl,
      collection: str(t.collection, 300) || null,
      part,
      parts: typeof t.parts === 'number' ? t.parts : null,
      glossary: (t.glossary as Record<string, string> | null) ?? null,
      questions: (t.questions as { q: string; options: string[]; answer: number }[] | null) ?? null,
    })
    result.texts++
  }

  // Тренировки: дубль — тот же тип в ту же миллисекунду.
  const existingSessions = await db
    .select({ type: readingSessions.type, createdAt: readingSessions.createdAt })
    .from(readingSessions)
    .where(eq(readingSessions.userId, userId))
  const sessionKeys = new Set(existingSessions.map((s) => `${s.type}#${s.createdAt.toISOString()}`))
  const newSessions = []
  for (const s of asArray(backup.sessions)) {
    const checked = parseSessionInput(s)
    const createdAt = new Date(str(s.createdAt, 40))
    if (!checked.ok || Number.isNaN(createdAt.getTime())) continue
    const key = `${checked.value.type}#${createdAt.toISOString()}`
    if (sessionKeys.has(key)) continue
    sessionKeys.add(key)
    newSessions.push({ userId, ...checked.value, createdAt })
  }
  for (let i = 0; i < newSessions.length; i += 500) {
    await db.insert(readingSessions).values(newSessions.slice(i, i + 500))
  }
  result.sessions = newSessions.length

  // Карточки: по слову. Уже существующую не трогаем — её прогресс свежее копии.
  for (const c of asArray(backup.cards)) {
    const en = str(c.en, 100).toLowerCase().trim()
    const ru = str(c.ru, 300).trim()
    if (!en || !ru) continue
    const dueAt = new Date(str(c.dueAt, 40))
    const inserted = await db
      .insert(readingCards)
      .values({
        userId,
        en,
        ru,
        ctx: str(c.ctx, 1000),
        forms: Array.isArray(c.forms)
          ? c.forms.filter((f): f is string => typeof f === 'string')
          : [],
        box: typeof c.box === 'number' ? Math.min(7, Math.max(0, Math.trunc(c.box))) : 0,
        dueAt: Number.isNaN(dueAt.getTime()) ? new Date() : dueAt,
      })
      .onConflictDoNothing({ target: [readingCards.userId, readingCards.en] })
      .returning({ id: readingCards.id })
    result.cards += inserted.length
  }

  // Настройки — только если своих ещё нет: текущие важнее старых.
  if (backup.settings && typeof backup.settings === 'object') {
    const [user] = await db
      .select({ settings: users.settings })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    const current = (user?.settings ?? {}) as Record<string, unknown>
    if (!current.reading) {
      await db
        .update(users)
        .set({ settings: { ...current, reading: backup.settings } })
        .where(and(eq(users.id, userId)))
    }
  }

  return result
}
