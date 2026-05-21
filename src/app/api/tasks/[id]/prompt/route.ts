import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks, projects, subtasks } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { buildDevTaskPrompt } from '@/lib/prompts/dev-task'

/**
 * GET /api/tasks/:id/prompt
 * Возвращает { prompt: string } — текст для буфера обмена / Telegram-сообщения.
 * Промт собирает данные задачи и связанного проекта из БД.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const [row] = await db
    .select({
      taskTitle: tasks.title,
      taskDescription: tasks.description,
      taskDeadlineAt: tasks.deadlineAt,
      taskDeadlineType: tasks.deadlineType,
      projectName: projects.name,
      projectSlug: projects.slug,
      projectDescription: projects.description,
      projectTechStack: projects.techStack,
      projectRepoPath: projects.repoPath,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(tasks.id, id), eq(tasks.userId, user.id)))
    .limit(1)

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const taskSubtasks = await db
    .select({ title: subtasks.title, isCompleted: subtasks.isCompleted })
    .from(subtasks)
    .where(eq(subtasks.taskId, id))
    .orderBy(subtasks.sortOrder)

  const prompt = buildDevTaskPrompt({
    task: {
      title: row.taskTitle,
      description: row.taskDescription,
      deadlineAt: row.taskDeadlineAt,
      deadlineType: row.taskDeadlineType,
      subtasks: taskSubtasks,
    },
    project: {
      name: row.projectName ?? 'Без проекта',
      slug: row.projectSlug,
      description: row.projectDescription,
      techStack: (row.projectTechStack as string[] | null) ?? null,
      repoPath: row.projectRepoPath,
    },
  })

  return NextResponse.json({ prompt })
}
