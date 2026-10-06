import { db } from '@/lib/db'
import { boards, tasks } from '@/lib/db/schema'
import { and, eq, isNull, notInArray } from 'drizzle-orm'

export type Board = typeof boards.$inferSelect

/**
 * Доска по умолчанию. Сюда падает всё, для чего доска не названа: быстрая
 * запись из бота, дела, пришедшие до того, как пользователь завёл свои доски.
 *
 * Создаётся лениво, а не миграцией: пользователь может появиться позже неё.
 * Частичный уникальный индекс `boards_user_inbox_idx` не даст завести вторую
 * даже при гонке двух запросов — на конфликт отвечаем чтением существующей.
 */
export async function ensureInboxBoard(userId: string): Promise<Board> {
  const existing = await db
    .select()
    .from(boards)
    .where(and(eq(boards.userId, userId), eq(boards.isInbox, true)))
    .limit(1)

  if (existing.length > 0) return existing[0]

  const created = await db
    .insert(boards)
    .values({ userId, name: 'Входящие', emoji: '📥', sortOrder: 0, isInbox: true })
    .onConflictDoNothing()
    .returning()

  if (created.length > 0) return created[0]

  // Доску успел создать параллельный запрос — она уже есть.
  const [board] = await db
    .select()
    .from(boards)
    .where(and(eq(boards.userId, userId), eq(boards.isInbox, true)))
    .limit(1)
  return board
}

/**
 * Личные дела, оставшиеся без доски, — во «Входящие».
 *
 * Нужна тем, кто завёл задачу между накатом миграции и выкладкой кода: такая
 * задача получила `board_id = NULL` и иначе не показалась бы ни на одной доске.
 */
export async function adoptOrphanTasks(userId: string, boardId: string): Promise<number> {
  const moved = await db
    .update(tasks)
    .set({ boardId })
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.boardId),
        isNull(tasks.externalSource),
        isNull(tasks.vaultPath),
        notInArray(tasks.status, ['ARCHIVED']),
      ),
    )
    .returning({ id: tasks.id })

  return moved.length
}
