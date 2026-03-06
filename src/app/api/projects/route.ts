import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { projects, tasks } from '@/lib/db/schema'
import { eq, and, sql, notInArray, count } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'

/** GET /api/projects */
export async function GET(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      type: projects.type,
      isDefault: projects.isDefault,
      sortOrder: projects.sortOrder,
      taskCount: count(tasks.id),
    })
    .from(projects)
    .leftJoin(
      tasks,
      and(
        eq(tasks.projectId, projects.id),
        notInArray(tasks.status, ['DONE', 'ARCHIVED']),
      ),
    )
    .where(eq(projects.userId, user.id))
    .groupBy(projects.id)
    .orderBy(projects.sortOrder)

  return NextResponse.json(userProjects)
}

/** POST /api/projects */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  if (!body.name) return NextResponse.json({ error: 'name обязателен' }, { status: 400 })

  const [project] = await db
    .insert(projects)
    .values({
      userId: user.id,
      name: body.name,
      type: body.type ?? 'DEFAULT',
    })
    .returning()

  return NextResponse.json(project, { status: 201 })
}
