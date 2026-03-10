import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'

/** GET /api/settings — получить настройки пользователя */
export async function GET(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [row] = await db
    .select({
      timezone: users.timezone,
      morningDigestTime: users.morningDigestTime,
      eveningDigestTime: users.eveningDigestTime,
      settings: users.settings,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(row)
}

/** PATCH /api/settings — обновить настройки пользователя */
export async function PATCH(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  const updateData: Record<string, unknown> = {}
  if (body.timezone !== undefined) updateData.timezone = body.timezone
  if (body.morningDigestTime !== undefined) updateData.morningDigestTime = body.morningDigestTime
  if (body.eveningDigestTime !== undefined) updateData.eveningDigestTime = body.eveningDigestTime

  // Мержим JSON-настройки (partial update)
  if (body.settings !== undefined) {
    const [current] = await db
      .select({ settings: users.settings })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1)

    const currentSettings = (current?.settings ?? {}) as Record<string, unknown>
    updateData.settings = { ...currentSettings, ...body.settings }
  }

  const [updated] = await db.update(users).set(updateData).where(eq(users.id, user.id)).returning()

  return NextResponse.json({ ok: true, user: updated })
}
