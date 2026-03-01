import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { subtasks } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'

/** PATCH /api/subtasks/:id */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()

  const updateData: Record<string, unknown> = {}
  if (body.title !== undefined) updateData.title = body.title
  if (body.isCompleted !== undefined) updateData.isCompleted = body.isCompleted
  if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder

  const [updated] = await db
    .update(subtasks)
    .set(updateData)
    .where(eq(subtasks.id, id))
    .returning()

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(updated)
}

/** DELETE /api/subtasks/:id */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await db.delete(subtasks).where(eq(subtasks.id, id))
  return NextResponse.json({ ok: true })
}
