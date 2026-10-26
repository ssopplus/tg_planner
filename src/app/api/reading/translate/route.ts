import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { readingTranslations } from '@/lib/db/schema'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { normalizeSurface } from '@/lib/reading/glossary'
import { readingLlmAvailable, translateWord } from '@/lib/reading/llm'

/**
 * POST /api/reading/translate — перевод слова, которого нет в глоссарии текста.
 * Порядок: общий кэш → LLM. Глоссарий проверяет сам Mini App, до запроса.
 */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { word?: unknown; sentence?: unknown }
  const word = normalizeSurface(typeof body.word === 'string' ? body.word : '')
  const sentence = typeof body.sentence === 'string' ? body.sentence.slice(0, 600) : ''
  if (!word) return NextResponse.json({ error: 'Нет слова' }, { status: 400 })

  const [cached] = await db
    .select()
    .from(readingTranslations)
    .where(eq(readingTranslations.word, word))
    .limit(1)
  if (cached) return NextResponse.json({ base: cached.base, ru: cached.ru, source: 'cache' })

  if (!readingLlmAvailable()) {
    return NextResponse.json({ error: 'Перевод недоступен: не настроен LLM' }, { status: 503 })
  }

  try {
    const result = await translateWord(word, sentence)
    if (!result) return NextResponse.json({ error: 'Перевод не получен' }, { status: 502 })
    await db
      .insert(readingTranslations)
      .values({ word, base: result.base, ru: result.ru })
      .onConflictDoNothing()
    return NextResponse.json({ ...result, source: 'ai' })
  } catch (error) {
    console.error('Ошибка перевода слова:', error)
    return NextResponse.json({ error: 'Перевод не получен' }, { status: 502 })
  }
}
