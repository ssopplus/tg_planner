import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, projects, subtasks } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'

/** GET /api/tasks/:id — детали задачи */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const [task] = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      priority: tasks.priority,
      status: tasks.status,
      deadlineAt: tasks.deadlineAt,
      deadlineType: tasks.deadlineType,
      myDayDate: tasks.myDayDate,
      overdueCount: tasks.overdueCount,
      completedAt: tasks.completedAt,
      createdAt: tasks.createdAt,
      projectId: tasks.projectId,
      projectName: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(tasks.id, id), eq(tasks.userId, user.id)))
    .limit(1)

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Подзадачи
  const taskSubtasks = await db
    .select()
    .from(subtasks)
    .where(eq(subtasks.taskId, id))
    .orderBy(subtasks.sortOrder)

  return NextResponse.json({ ...task, subtasks: taskSubtasks })
}

/** PATCH /api/tasks/:id — обновить задачу */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()

  const updateData: Record<string, unknown> = {}
  if (body.title !== undefined) updateData.title = body.title
  if (body.description !== undefined) updateData.description = body.description
  if (body.priority !== undefined) updateData.priority = body.priority
  if (body.status !== undefined) {
    updateData.status = body.status
    if (body.status === 'DONE') updateData.completedAt = new Date()
  }
  if (body.deadlineAt !== undefined) updateData.deadlineAt = body.deadlineAt ? new Date(body.deadlineAt) : null
  if (body.deadlineType !== undefined) updateData.deadlineType = body.deadlineType
  if (body.projectId !== undefined) updateData.projectId = body.projectId
  if (body.myDayDate !== undefined) updateData.myDayDate = body.myDayDate

  const [updated] = await db
    .update(tasks)
    .set(updateData)
    .where(and(eq(tasks.id, id), eq(tasks.userId, user.id)))
    .returning()

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(updated)
}

/** DELETE /api/tasks/:id — удалить задачу */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  await db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, user.id)))

  return NextResponse.json({ ok: true })
}
