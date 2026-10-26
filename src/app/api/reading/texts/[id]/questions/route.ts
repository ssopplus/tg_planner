import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { readingTexts } from '@/lib/db/schema'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { generateQuiz, readingLlmAvailable } from '@/lib/reading/llm'

/** Генерация вопросов дольше обычного запроса: модель пишет 4 вопроса и глоссарий. */
export const maxDuration = 60

/**
 * POST /api/reading/texts/[id]/questions — вопросы на понимание к своему
 * тексту через LLM. Английскому тексту заодно уточняется уровень и
 * добавляется глоссарий.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!readingLlmAvailable()) {
    return NextResponse.json({ error: 'Не настроен LLM' }, { status: 503 })
  }

  const { id } = await params
  const [text] = await db
    .select()
    .from(readingTexts)
    .where(and(eq(readingTexts.id, id), eq(readingTexts.userId, user.id)))
    .limit(1)
  if (!text) return NextResponse.json({ error: 'Текст не найден' }, { status: 404 })

  try {
    const quiz = await generateQuiz(text.body, text.lang === 'en' ? 'en' : 'ru')
    if (!quiz) return NextResponse.json({ error: 'Вопросы не получились' }, { status: 502 })
    await db
      .update(readingTexts)
      .set({
        questions: quiz.questions,
        ...(text.lang === 'en' && quiz.level ? { level: quiz.level } : {}),
        ...(text.lang === 'en' && quiz.glossary
          ? { glossary: { ...(text.glossary ?? {}), ...quiz.glossary } }
          : {}),
      })
      .where(eq(readingTexts.id, id))
    return NextResponse.json({ ok: true, questions: quiz.questions.length })
  } catch (error) {
    console.error('Ошибка генерации вопросов:', error)
    return NextResponse.json({ error: 'Вопросы не получились' }, { status: 502 })
  }
}
