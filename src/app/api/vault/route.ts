import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { projects, tasks } from '@/lib/db/schema'
import { and, eq, isNotNull, notInArray } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'

/**
 * GET /api/vault — задачи, пришедшие из Obsidian-vault, сгруппированные по
 * проектам.
 *
 * Только чтение: источником этих задач остаётся сам vault (`tasks.md`), и
 * правка здесь разъехалась бы с файлом при следующей синхронизации.
 */
export async function GET(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const withDone = searchParams.get('done') === '1'

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      vaultPath: tasks.vaultPath,
      completedAt: tasks.completedAt,
      projectId: tasks.projectId,
      projectName: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(tasks.userId, user.id),
        isNotNull(tasks.vaultPath),
        ...(withDone ? [] : [notInArray(tasks.status, ['DONE', 'ARCHIVED'])]),
      ),
    )
    .orderBy(projects.name, tasks.createdAt)

  // Группируем на сервере: клиенту нужен готовый список проектов, а не
  // повторная сборка той же структуры из плоского ответа.
  const grouped = new Map<
    string,
    { projectId: string | null; projectName: string; tasks: typeof rows }
  >()

  for (const row of rows) {
    const key = row.projectId ?? 'none'
    const entry = grouped.get(key) ?? {
      projectId: row.projectId,
      projectName: row.projectName ?? 'Без проекта',
      tasks: [],
    }
    entry.tasks.push(row)
    grouped.set(key, entry)
  }

  return NextResponse.json(Array.from(grouped.values()))
}
