import { and, asc, count, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { readingCards, readingSessions } from '@/lib/db/schema'
import { gradeCard } from './srs'
import type { SessionInput } from './session-input'
import type { CardGrade } from './types'

/**
 * Запросы к таблицам тренажёра, общие для API Mini App и бота: напоминания и
 * повторение карточек в чате работают с теми же данными, что и приложение.
 */

/** Сколько истории отдаём в Mini App: серии и графику хватает с запасом. */
const HISTORY_DAYS = 400

export const sessionColumns = {
  id: readingSessions.id,
  type: readingSessions.type,
  lang: readingSessions.lang,
  day: readingSessions.day,
  wpm: readingSessions.wpm,
  comp: readingSessions.comp,
  ms: readingSessions.ms,
  textId: readingSessions.textId,
  title: readingSessions.title,
  cardsReviewed: readingSessions.cardsReviewed,
  wordsSaved: readingSessions.wordsSaved,
  createdAt: readingSessions.createdAt,
}

export const cardColumns = {
  id: readingCards.id,
  en: readingCards.en,
  ru: readingCards.ru,
  ctx: readingCards.ctx,
  forms: readingCards.forms,
  box: readingCards.box,
  dueAt: readingCards.dueAt,
  createdAt: readingCards.createdAt,
}

export async function loadSessions(userId: string) {
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000)
  return db
    .select(sessionColumns)
    .from(readingSessions)
    .where(and(eq(readingSessions.userId, userId), gte(readingSessions.createdAt, since)))
    .orderBy(asc(readingSessions.createdAt))
}

export async function loadCards(userId: string) {
  return db
    .select(cardColumns)
    .from(readingCards)
    .where(eq(readingCards.userId, userId))
    .orderBy(asc(readingCards.dueAt))
}

export async function recordSession(userId: string, input: SessionInput) {
  const [row] = await db
    .insert(readingSessions)
    .values({ userId, ...input })
    .returning(sessionColumns)
  return row
}

/** Дни с тренировками — для серии. */
export async function sessionDays(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ day: readingSessions.day })
    .from(readingSessions)
    .where(eq(readingSessions.userId, userId))
    .orderBy(desc(readingSessions.day))
    .limit(HISTORY_DAYS)
  return rows.map((r) => r.day)
}

/**
 * Новая карточка или дополнение существующей: то же слово, встреченное в
 * другой форме, добавляет форму, а перевод и прогресс повторения не трогает.
 */
export async function upsertCard(
  userId: string,
  input: { en: string; ru: string; ctx: string; surface?: string | null },
) {
  const en = input.en.toLowerCase().trim()
  const surface = input.surface?.toLowerCase().trim()
  const forms = surface && surface !== en ? [surface] : []
  const [row] = await db
    .insert(readingCards)
    .values({ userId, en, ru: input.ru.trim(), ctx: input.ctx.trim(), forms })
    .onConflictDoUpdate({
      target: [readingCards.userId, readingCards.en],
      set: {
        forms: sql`(
          select coalesce(jsonb_agg(distinct f), '[]'::jsonb)
          from jsonb_array_elements_text(${readingCards.forms} || excluded.forms) as f
        )`,
      },
    })
    .returning(cardColumns)
  return row
}

export async function applyGrade(
  userId: string,
  cardId: string,
  grade: CardGrade,
  now = Date.now(),
) {
  const [card] = await db
    .select({ box: readingCards.box })
    .from(readingCards)
    .where(and(eq(readingCards.id, cardId), eq(readingCards.userId, userId)))
    .limit(1)
  if (!card) return null
  const next = gradeCard(card.box, grade, now)
  const [row] = await db
    .update(readingCards)
    .set({ box: next.box, dueAt: new Date(next.dueAt) })
    .where(and(eq(readingCards.id, cardId), eq(readingCards.userId, userId)))
    .returning(cardColumns)
  return row
}

export async function deleteCard(userId: string, cardId: string): Promise<boolean> {
  const rows = await db
    .delete(readingCards)
    .where(and(eq(readingCards.id, cardId), eq(readingCards.userId, userId)))
    .returning({ id: readingCards.id })
  return rows.length > 0
}

export async function countDueCards(userId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(readingCards)
    .where(and(eq(readingCards.userId, userId), lte(readingCards.dueAt, now)))
  return row?.value ?? 0
}

/** Самая давняя карточка к повторению, кроме уже показанной в этом проходе. */
export async function nextDueCard(userId: string, now = new Date()) {
  const [row] = await db
    .select(cardColumns)
    .from(readingCards)
    .where(and(eq(readingCards.userId, userId), lte(readingCards.dueAt, now)))
    .orderBy(asc(readingCards.dueAt))
    .limit(1)
  return row ?? null
}

export async function getCard(userId: string, cardId: string) {
  const [row] = await db
    .select(cardColumns)
    .from(readingCards)
    .where(and(eq(readingCards.id, cardId), eq(readingCards.userId, userId)))
    .limit(1)
  return row ?? null
}
