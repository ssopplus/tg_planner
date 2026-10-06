import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, projects, subtasks } from '@/lib/db/schema'
import { eq, and, sql, inArray, or, ilike, isNull, isNotNull, asc } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { ensureInboxBoard } from '@/lib/boards/inbox'

/** GET /api/tasks — список задач пользователя */
export async function GET(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')
  const projectIds = searchParams.get('project_ids')
  const status = searchParams.get('status')
  const sort = searchParams.get('sort') ?? 'deadline'
  // Источник задач: рабочие из Трекера или внутренние (Obsidian + заведённые
  // руками). Разделение идёт по external_source — отдельного поля не нужно.
  const source = searchParams.get('source') ?? 'all'
  // Доска личных дел. `board_id=any` — все дела с любой доски, нужен боту
  // для сводки дня, когда конкретная доска неважна.
  const boardId = searchParams.get('board_id')
  const page = parseInt(searchParams.get('page') ?? '1')
  const limit = parseInt(searchParams.get('limit') ?? '50')
  const q = searchParams.get('q')?.trim() ?? ''

  const conditions = [eq(tasks.userId, user.id)]
  if (projectIds) {
    conditions.push(inArray(tasks.projectId, projectIds.split(',')))
  } else if (projectId) {
    conditions.push(eq(tasks.projectId, projectId))
  }
  if (status) {
    const statuses = status.split(',') as ('TODO' | 'IN_PROGRESS' | 'DONE' | 'ARCHIVED')[]
    conditions.push(inArray(tasks.status, statuses))
  } else {
    conditions.push(inArray(tasks.status, ['TODO', 'IN_PROGRESS']))
  }
  if (boardId === 'any') {
    conditions.push(isNotNull(tasks.boardId))
  } else if (boardId) {
    conditions.push(eq(tasks.boardId, boardId))
  }
  if (source === 'tracker') {
    conditions.push(isNotNull(tasks.externalSource))
  } else if (source === 'internal') {
    conditions.push(isNull(tasks.externalSource))
  }
  if (q) {
    // Ищем по title и description. Escape LIKE-метасимволов, чтобы % в запросе
    // не превращал текст в wildcard-паттерн.
    const escaped = q.replace(/[\\%_]/g, (m) => `\\${m}`)
    const pattern = `%${escaped}%`
    const searchCondition = or(
      ilike(tasks.title, pattern),
      ilike(tasks.description, pattern),
      ilike(tasks.body, pattern),
    )
    if (searchCondition) conditions.push(searchCondition)
  }

  const userTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      body: tasks.body,
      dueDate: tasks.dueDate,
      boardId: tasks.boardId,
      priority: tasks.priority,
      status: tasks.status,
      deadlineAt: tasks.deadlineAt,
      deadlineType: tasks.deadlineType,
      overdueCount: tasks.overdueCount,
      createdAt: tasks.createdAt,
      projectId: tasks.projectId,
      projectName: projects.name,
      externalSource: tasks.externalSource,
      externalId: tasks.externalId,
      vaultPath: tasks.vaultPath,
      sortOrder: tasks.sortOrder,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(...conditions))
    // manual — ручное ранжирование перетаскиванием (tasks.sort_order).
    // Вторичный ключ createdAt нужен, пока порядок не задан: у всех задач
    // sort_order = 0, и без него выдача была бы нестабильной между запросами.
    .orderBy(
      ...(sort === 'manual'
        ? [asc(tasks.sortOrder), asc(tasks.createdAt)]
        : sort === 'priority'
          ? [tasks.priority]
          : sort === 'created'
            ? [tasks.createdAt]
            : [tasks.deadlineAt]),
    )
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
  // Личное дело: доска, текст заметки и срок-день. boardId не передали —
  // кладём во «Входящие», иначе дело не попадёт ни на одну доску.
  const { boardId, dueDate } = body as { boardId?: string | null; dueDate?: string | null }
  const noteBody = (body as { body?: string | null }).body ?? null

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

  const resolvedBoardId = boardId === undefined ? (await ensureInboxBoard(user.id)).id : boardId

  const [task] = await db
    .insert(tasks)
    .values({
      userId: user.id,
      projectId: resolvedProjectId,
      title,
      description: description ?? null,
      body: noteBody,
      boardId: resolvedBoardId,
      dueDate: dueDate ?? null,
      priority: priority ?? 'MEDIUM',
      deadlineAt: deadlineAt ? new Date(deadlineAt) : null,
      deadlineType: deadlineType ?? null,
    })
    .returning()

  return NextResponse.json(task, { status: 201 })
}
