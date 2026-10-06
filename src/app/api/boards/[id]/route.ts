import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { boards, tasks } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { ensureInboxBoard } from '@/lib/boards/inbox'

/** PATCH /api/boards/[id] — переименование, эмодзи, цвет, порядок. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await request.json()) as {
    name?: string
    emoji?: string | null
    color?: string | null
    sortOrder?: number
  }

  const patch: Partial<typeof boards.$inferInsert> = {}
  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: 'Название доски обязательно' }, { status: 400 })
    patch.name = name
  }
  if (body.emoji !== undefined) patch.emoji = body.emoji?.trim() || null
  if (body.color !== undefined) patch.color = body.color?.trim() || null
  if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder

  const [board] = await db
    .update(boards)
    .set(patch)
    .where(and(eq(boards.id, id), eq(boards.userId, user.id)))
    .returning()

  if (!board) return NextResponse.json({ error: 'Доска не найдена' }, { status: 404 })
  return NextResponse.json(board)
}

/**
 * DELETE /api/boards/[id] — удаление доски.
 *
 * Дела с неё не удаляются, а переезжают во «Входящие»: удалить доску —
 * решение про группировку, а не про содержимое. «Входящие» удалить нельзя,
 * иначе быстрой записи некуда падать.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const [board] = await db
    .select()
    .from(boards)
    .where(and(eq(boards.id, id), eq(boards.userId, user.id)))
    .limit(1)

  if (!board) return NextResponse.json({ error: 'Доска не найдена' }, { status: 404 })
  if (board.isInbox) {
    return NextResponse.json({ error: 'Доску «Входящие» удалить нельзя' }, { status: 400 })
  }

  const inbox = await ensureInboxBoard(user.id)
  const moved = await db
    .update(tasks)
    .set({ boardId: inbox.id })
    .where(and(eq(tasks.boardId, id), eq(tasks.userId, user.id)))
    .returning({ id: tasks.id })

  await db.delete(boards).where(and(eq(boards.id, id), eq(boards.userId, user.id)))

  return NextResponse.json({ ok: true, movedToInbox: moved.length })
}
