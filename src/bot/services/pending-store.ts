import { and, eq, lt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pendingTasks } from '@/lib/db/schema'
import type { Priority, DeadlineType } from '../types'

/**
 * Полезная нагрузка распарсенной задачи. Сохраняется в БД в jsonb-поле.
 * Из БД даты приходят строками — поэтому здесь deadlineAt: string,
 * а при чтении конвертируем обратно в Date.
 */
export interface PendingTaskPayload {
  title: string
  description?: string
  projectId: string
  priority?: Priority
  deadlineAt?: string // ISO-строка
  deadlineType?: DeadlineType
  recurrence?: string
}

/**
 * Совместимая форма для существующих обработчиков.
 * Раньше pendingTasks.get(id) возвращал объект с deadlineAt: Date.
 */
export interface PendingTask {
  title: string
  description?: string
  projectId: string
  priority?: Priority
  deadlineAt?: Date
  deadlineType?: DeadlineType
  recurrence?: string
}

const PENDING_TTL_MS = 5 * 60 * 1000 // 5 минут

/**
 * Добавить распарсенную задачу в ожидание подтверждения.
 * Хранится в Postgres, переживает рестарт лямбды.
 */
export async function addPendingTask(
  userId: string,
  task: PendingTask,
): Promise<string> {
  const id = crypto.randomUUID().slice(0, 8)
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS)

  const payload: PendingTaskPayload = {
    title: task.title,
    description: task.description,
    projectId: task.projectId,
    priority: task.priority,
    deadlineAt: task.deadlineAt?.toISOString(),
    deadlineType: task.deadlineType,
    recurrence: task.recurrence,
  }

  await db.insert(pendingTasks).values({
    id,
    userId,
    payload,
    expiresAt,
  })

  return id
}

/**
 * Получить задачу по ID. Возвращает null, если запись не найдена или просрочена.
 */
export async function getPendingTask(id: string): Promise<PendingTask | null> {
  const [row] = await db
    .select()
    .from(pendingTasks)
    .where(eq(pendingTasks.id, id))
    .limit(1)

  if (!row) return null
  if (row.expiresAt.getTime() < Date.now()) {
    // Истекла — удаляем и возвращаем null
    await db.delete(pendingTasks).where(eq(pendingTasks.id, id))
    return null
  }

  const payload = row.payload as PendingTaskPayload
  return {
    title: payload.title,
    description: payload.description,
    projectId: payload.projectId,
    priority: payload.priority,
    deadlineAt: payload.deadlineAt ? new Date(payload.deadlineAt) : undefined,
    deadlineType: payload.deadlineType,
    recurrence: payload.recurrence,
  }
}

/**
 * Удалить запись из pending store.
 */
export async function deletePendingTask(id: string): Promise<void> {
  await db.delete(pendingTasks).where(eq(pendingTasks.id, id))
}

/**
 * Удалить все просроченные записи. Вызывается cron-эндпоинтом.
 * Возвращает количество удалённых строк.
 */
export async function purgeExpiredPendingTasks(): Promise<number> {
  const result = await db
    .delete(pendingTasks)
    .where(lt(pendingTasks.expiresAt, new Date()))
    .returning({ id: pendingTasks.id })
  return result.length
}
