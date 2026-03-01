import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { subtasks, tasks } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'

/** GET /api/tasks/:id/subtasks */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const result = await db
    .select()
    .from(subtasks)
    .where(eq(subtasks.taskId, id))
    .orderBy(subtasks.sortOrder)

  return NextResponse.json(result)
}

/** POST /api/tasks/:id/subtasks */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: taskId } = await params
  const body = await request.json()

  // Проверяем, что задача принадлежит пользователю
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, user.id)))
    .limit(1)
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Определяем следующий sortOrder
  const [{ maxOrder }] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${subtasks.sortOrder}), -1)::int` })
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId))

  const [created] = await db
    .insert(subtasks)
    .values({
      taskId,
      title: body.title,
      sortOrder: maxOrder + 1,
    })
    .returning()

  return NextResponse.json(created, { status: 201 })
}
