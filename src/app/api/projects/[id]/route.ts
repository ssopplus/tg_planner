import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'

/** PATCH /api/projects/:id */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()

  const updateData: Record<string, unknown> = {}
  if (body.name !== undefined) updateData.name = body.name
  if (body.type !== undefined) updateData.type = body.type

  const [updated] = await db
    .update(projects)
    .set(updateData)
    .where(and(eq(projects.id, id), eq(projects.userId, user.id)))
    .returning()

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(updated)
}

/** DELETE /api/projects/:id */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Не удаляем дефолтный проект
  const [project] = await db
    .select({ isDefault: projects.isDefault })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, user.id)))
    .limit(1)

  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.isDefault) return NextResponse.json({ error: 'Нельзя удалить проект по умолчанию' }, { status: 400 })

  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, user.id)))
  return NextResponse.json({ ok: true })
}
