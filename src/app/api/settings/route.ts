import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'

/** PATCH /api/settings — обновить настройки пользователя */
export async function PATCH(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  const updateData: Record<string, unknown> = {}
  if (body.timezone !== undefined) updateData.timezone = body.timezone
  if (body.morningDigestTime !== undefined) updateData.morningDigestTime = body.morningDigestTime
  if (body.eveningDigestTime !== undefined) updateData.eveningDigestTime = body.eveningDigestTime

  const [updated] = await db.update(users).set(updateData).where(eq(users.id, user.id)).returning()

  return NextResponse.json({ ok: true, user: updated })
}
