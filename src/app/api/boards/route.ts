import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { boards, tasks } from '@/lib/db/schema'
import { eq, and, count, notInArray, max } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { ensureInboxBoard } from '@/lib/boards/inbox'

/** GET /api/boards — доски пользователя со счётчиком незакрытых дел. */
export async function GET(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Первый заход после переработки: доски ещё нет, а раздел открыть надо.
  await ensureInboxBoard(user.id)

  const rows = await db
    .select({
      id: boards.id,
      name: boards.name,
      emoji: boards.emoji,
      color: boards.color,
      sortOrder: boards.sortOrder,
      isInbox: boards.isInbox,
      taskCount: count(tasks.id),
    })
    .from(boards)
    .leftJoin(
      tasks,
      and(eq(tasks.boardId, boards.id), notInArray(tasks.status, ['DONE', 'ARCHIVED'])),
    )
    .where(eq(boards.userId, user.id))
    .groupBy(boards.id)
    .orderBy(boards.sortOrder, boards.name)

  return NextResponse.json(rows)
}

/** POST /api/boards — новая доска. */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { name?: string; emoji?: string; color?: string }
  const name = body.name?.trim()
  if (!name) return NextResponse.json({ error: 'Название доски обязательно' }, { status: 400 })

  // Новая доска встаёт в конец ленты.
  const [{ value: lastOrder }] = await db
    .select({ value: max(boards.sortOrder) })
    .from(boards)
    .where(eq(boards.userId, user.id))

  const [board] = await db
    .insert(boards)
    .values({
      userId: user.id,
      name,
      emoji: body.emoji?.trim() || null,
      color: body.color?.trim() || null,
      sortOrder: (lastOrder ?? 0) + 1,
    })
    .returning()

  return NextResponse.json(board, { status: 201 })
}
