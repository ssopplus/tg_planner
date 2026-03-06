import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, projects, subtasks } from '@/lib/db/schema'
import { eq, and, sql, inArray } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'

/** GET /api/tasks — список задач пользователя */
export async function GET(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const status = searchParams.get('status')
  const sort = searchParams.get('sort') ?? 'deadline'
  const page = parseInt(searchParams.get('page') ?? '1')
  const limit = parseInt(searchParams.get('limit') ?? '50')

  const conditions = [eq(tasks.userId, user.id)]
  if (projectId) conditions.push(eq(tasks.projectId, projectId))
  if (status) {
    const statuses = status.split(',') as ('TODO' | 'IN_PROGRESS' | 'DONE' | 'ARCHIVED')[]
    conditions.push(inArray(tasks.status, statuses))
  } else {
    conditions.push(eq(tasks.status, 'TODO'))
  }

  const userTasks = await db
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
      createdAt: tasks.createdAt,
      projectId: tasks.projectId,
      projectName: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(sort === 'priority' ? tasks.priority : sort === 'created' ? tasks.createdAt : tasks.deadlineAt)
    .limit(limit)
    .offset((page - 1) * limit)

  // Подсчёт подзадач для каждой задачи
  const taskIds = userTasks.map((t) => t.id)
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

  const result = userTasks.map((t) => ({
    ...t,
    subtaskTotal: subtaskCounts[t.id]?.total ?? 0,
    subtaskCompleted: subtaskCounts[t.id]?.completed ?? 0,
  }))

  return NextResponse.json(result)
}

/** POST /api/tasks — создать задачу */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { title, projectId, priority, deadlineAt, deadlineType, description } = body

  if (!title) {
    return NextResponse.json({ error: 'title обязателен' }, { status: 400 })
  }

  // Если projectId не передан — используем дефолтный проект пользователя
  let resolvedProjectId = projectId
  if (!resolvedProjectId) {
    let [defaultProject] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, user.id), eq(projects.isDefault, true)))
      .limit(1)

    if (!defaultProject) {
      ;[defaultProject] = await db
        .insert(projects)
        .values({ userId: user.id, name: 'Входящие', isDefault: true })
        .returning({ id: projects.id })
    }
    resolvedProjectId = defaultProject.id
  }

  const [task] = await db
    .insert(tasks)
    .values({
      userId: user.id,
      projectId: resolvedProjectId,
      title,
      description: description ?? null,
      priority: priority ?? 'MEDIUM',
      deadlineAt: deadlineAt ? new Date(deadlineAt) : null,
      deadlineType: deadlineType ?? null,
    })
    .returning()

  return NextResponse.json(task, { status: 201 })
}
