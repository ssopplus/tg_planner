import { NextRequest, NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { readingTexts } from '@/lib/db/schema'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { validateCustomText } from '@/lib/reading/text-utils'

/** Поля текста для Mini App — всё, кроме владельца. */
const textColumns = {
  id: readingTexts.id,
  lang: readingTexts.lang,
  level: readingTexts.level,
  title: readingTexts.title,
  body: readingTexts.body,
  wordCount: readingTexts.wordCount,
  source: readingTexts.source,
  sourceUrl: readingTexts.sourceUrl,
  glossary: readingTexts.glossary,
  questions: readingTexts.questions,
  createdAt: readingTexts.createdAt,
}

/**
 * GET /api/reading/texts — свои тексты пользователя, новые сверху.
 * Встроенные тексты сюда не входят: они в бандле Mini App.
 */
export async function GET(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await db
    .select(textColumns)
    .from(readingTexts)
    .where(eq(readingTexts.userId, user.id))
    .orderBy(desc(readingTexts.createdAt))

  return NextResponse.json(rows)
}

/** POST /api/reading/texts — свой текст, вставленный в форму. */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const checked = validateCustomText(await request.json())
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })

  const [created] = await db
    .insert(readingTexts)
    .values({ userId: user.id, source: 'paste', ...checked.value })
    .returning(textColumns)

  return NextResponse.json(created, { status: 201 })
}
