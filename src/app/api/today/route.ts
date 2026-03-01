import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, projects, subtasks } from '@/lib/db/schema'
import { eq, and, or, lte, lt, sql, inArray } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'

/** GET /api/today — задачи «Моего дня» */
export async function GET(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59)

  const myDayTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      priority: tasks.priority,
      status: tasks.status,
      deadlineAt: tasks.deadlineAt,
      deadlineType: tasks.deadlineType,
      myDayDate: tasks.myDayDate,
      myDaySortOrder: tasks.myDaySortOrder,
      overdueCount: tasks.overdueCount,
      createdAt: tasks.createdAt,
      projectId: tasks.projectId,
      projectName: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(tasks.userId, user.id),
        eq(tasks.status, 'TODO'),
        or(
          eq(tasks.myDayDate, todayStr),
          lte(tasks.deadlineAt, endOfDay),
          and(eq(tasks.priority, 'HIGH'), sql`${tasks.deadlineAt} IS NULL`),
        ),
      ),
    )
    .orderBy(tasks.myDaySortOrder, tasks.deadlineAt)

  // Подсчёт подзадач
  const taskIds = myDayTasks.map((t) => t.id)
  let subtaskCounts: Record<string, { total: number; completed: number }> = {}

  if (taskIds.length > 0) {
    const counts = await db
      .select({
        taskId: subtasks.taskId,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${subtasks.isCompleted})::int`,
      })
      .from(subtasks)
      .where(inArray(subtasks.taskId, taskIds))
      .groupBy(subtasks.taskId)

    subtaskCounts = Object.fromEntries(counts.map((c) => [c.taskId, { total: c.total, completed: c.completed }]))
  }

  const result = myDayTasks.map((t) => ({
    ...t,
    subtaskTotal: subtaskCounts[t.id]?.total ?? 0,
    subtaskCompleted: subtaskCounts[t.id]?.completed ?? 0,
  }))

  return NextResponse.json(result)
}

/** PATCH /api/today — обновить порядок задач «Моего дня» */
export async function PATCH(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { ids } = body as { ids: string[] }

  if (!Array.isArray(ids)) {
    return NextResponse.json({ error: 'ids должен быть массивом' }, { status: 400 })
  }

  // Обновляем sort_order для каждой задачи
  for (let i = 0; i < ids.length; i++) {
    await db
      .update(tasks)
      .set({ myDaySortOrder: i })
      .where(and(eq(tasks.id, ids[i]), eq(tasks.userId, user.id)))
  }

  return NextResponse.json({ ok: true })
}
