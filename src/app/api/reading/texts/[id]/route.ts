import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { readingTexts } from '@/lib/db/schema'
import { authorizeMiniApp } from '@/lib/telegram/auth'

/**
 * DELETE /api/reading/texts/[id] — удалить свой текст. С `?whole=1` — все
 * части книги или статьи (по общему источнику). Сессии по тексту остаются:
 * в них записано название, и статистика не должна проседать.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const [text] = await db
    .select({ sourceUrl: readingTexts.sourceUrl })
    .from(readingTexts)
    .where(and(eq(readingTexts.id, id), eq(readingTexts.userId, user.id)))
    .limit(1)
  if (!text) return NextResponse.json({ error: 'Текст не найден' }, { status: 404 })

  const whole = request.nextUrl.searchParams.get('whole') === '1' && text.sourceUrl
  const deleted = await db
    .delete(readingTexts)
    .where(
      and(
        eq(readingTexts.userId, user.id),
        whole ? eq(readingTexts.sourceUrl, text.sourceUrl!) : eq(readingTexts.id, id),
      ),
    )
    .returning({ id: readingTexts.id })

  return NextResponse.json({ ok: true, deleted: deleted.length })
}
