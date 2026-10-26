import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { readingTexts } from '@/lib/db/schema'
import { authorizeMiniApp } from '@/lib/telegram/auth'

/**
 * DELETE /api/reading/texts/[id] — удалить свой текст. Сессии по нему
 * остаются: в них записано название, и статистика не должна проседать.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const [deleted] = await db
    .delete(readingTexts)
    .where(and(eq(readingTexts.id, id), eq(readingTexts.userId, user.id)))
    .returning({ id: readingTexts.id })

  if (!deleted) return NextResponse.json({ error: 'Текст не найден' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
