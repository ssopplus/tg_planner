import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'

/**
 * POST /api/tasks/bulk — массовые действия над задачами.
 *
 * Body: { ids: string[], action: 'done' | 'todo' | 'delete' | 'assign', projectId?: string }
 *
 * Проверяет, что все id принадлежат текущему пользователю: WHERE user_id = me,
 * несоответствующие пропускаются молча (никакой ошибки для клиента — иначе
 * даст утечку факта существования чужого id).
 *
 * Возвращает { affected: number }.
 */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as {
    ids?: string[]
    action?: 'done' | 'todo' | 'delete' | 'assign'
    projectId?: string
  }

  const ids = body.ids ?? []
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids обязательны' }, { status: 400 })
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: 'слишком много задач (макс 500)' }, { status: 400 })
  }

  const scope = and(eq(tasks.userId, user.id), inArray(tasks.id, ids))

  switch (body.action) {
    case 'done': {
      const updated = await db
        .update(tasks)
        .set({ status: 'DONE', completedAt: new Date() })
        .where(scope)
        .returning({ id: tasks.id })
      return NextResponse.json({ affected: updated.length })
    }
    case 'todo': {
      const updated = await db
        .update(tasks)
        .set({ status: 'TODO', completedAt: null })
        .where(scope)
        .returning({ id: tasks.id })
      return NextResponse.json({ affected: updated.length })
    }
    case 'delete': {
      const deleted = await db.delete(tasks).where(scope).returning({ id: tasks.id })
      return NextResponse.json({ affected: deleted.length })
    }
    case 'assign': {
      if (!body.projectId) {
        return NextResponse.json({ error: 'projectId обязателен для assign' }, { status: 400 })
      }
      const updated = await db
        .update(tasks)
        .set({ projectId: body.projectId })
        .where(scope)
        .returning({ id: tasks.id })
      return NextResponse.json({ affected: updated.length })
    }
    default:
      return NextResponse.json({ error: 'неизвестное action' }, { status: 400 })
  }
}
