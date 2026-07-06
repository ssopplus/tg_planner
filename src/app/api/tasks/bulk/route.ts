import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { writeBackTaskToVault } from '@/lib/obsidian/vault-writer'

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

  /**
   * Write-back в vault для задач-из-obsidian при массовом done/todo.
   * Отправляем каждый как отдельный GitHub-коммит — это дороже, но чек-бокс
   * в vault важнее батч-эффективности; поведение всё равно fire-and-forget.
   * delete/assign в vault не пишем: удаление строки потеряло бы историю,
   * а переезд между файлами при assign — отдельная фича.
   */
  function scheduleVaultWriteBacks(
    rows: Array<{ id: string; title: string | null; vaultPath: string | null }>,
    isCompleted: boolean,
  ) {
    for (const t of rows) {
      if (!t.vaultPath) continue
      writeBackTaskToVault({
        vaultPath: t.vaultPath,
        taskUuid: t.id,
        updates: { isCompleted },
        taskTitle: t.title ?? undefined,
      })
        .then((r) => {
          if (!r.ok) console.warn(`[vault write-back bulk] ${t.id}: ${r.reason}`)
        })
        .catch((err) => console.warn(`[vault write-back bulk] ${t.id} threw:`, err))
    }
  }

  switch (body.action) {
    case 'done': {
      const updated = await db
        .update(tasks)
        .set({ status: 'DONE', completedAt: new Date() })
        .where(scope)
        .returning({ id: tasks.id, title: tasks.title, vaultPath: tasks.vaultPath })
      scheduleVaultWriteBacks(updated, true)
      return NextResponse.json({ affected: updated.length })
    }
    case 'todo': {
      const updated = await db
        .update(tasks)
        .set({ status: 'TODO', completedAt: null })
        .where(scope)
        .returning({ id: tasks.id, title: tasks.title, vaultPath: tasks.vaultPath })
      scheduleVaultWriteBacks(updated, false)
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
