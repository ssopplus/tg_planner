import { and, eq, gt, lt } from 'drizzle-orm'
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
  /**
   * Доска и срок, выбранные руками при редактировании черновика.
   *
   * Пока их нет, обе величины угадываются из текста при подтверждении. Как
   * только пользователь выбрал явно — угадывание перебивается: иначе правка
   * молча откатывалась бы к тому, что разобрал парсер.
   */
  boardId?: string
  dueDate?: string | null
  /** Бот ждёт от пользователя новое название этим сообщением. */
  awaitingTitle?: boolean
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
  boardId?: string
  dueDate?: string | null
  awaitingTitle?: boolean
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
    boardId: task.boardId,
    dueDate: task.dueDate,
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
    boardId: payload.boardId,
    dueDate: payload.dueDate,
    awaitingTitle: payload.awaitingTitle,
  }
}

/**
 * Правка черновика: сливает переданные поля с сохранёнными и продлевает срок
 * жизни записи.
 *
 * Продление обязательно: исходные пять минут рассчитаны на «подтвердил или
 * отменил», а правка названия требует отдельного сообщения, и черновик
 * успевал протухнуть прямо посреди редактирования.
 */
export async function updatePendingTask(
  id: string,
  patch: Partial<PendingTaskPayload>,
): Promise<PendingTask | null> {
  const [row] = await db.select().from(pendingTasks).where(eq(pendingTasks.id, id)).limit(1)
  if (!row) return null

  const payload = { ...(row.payload as PendingTaskPayload), ...patch }
  await db
    .update(pendingTasks)
    .set({ payload, expiresAt: new Date(Date.now() + PENDING_TTL_MS) })
    .where(eq(pendingTasks.id, id))

  return getPendingTask(id)
}

/**
 * Черновик этого пользователя, который ждёт нового названия.
 *
 * Состояние живёт в самой записи, а не в памяти процесса: бот работает
 * вебхуком на лямбде, и между нажатием кнопки и ответным сообщением
 * процесс успевает смениться.
 */
export async function findAwaitingTitle(
  userId: string,
): Promise<{ id: string; task: PendingTask } | null> {
  const rows = await db
    .select()
    .from(pendingTasks)
    .where(and(eq(pendingTasks.userId, userId), gt(pendingTasks.expiresAt, new Date())))

  for (const row of rows) {
    if ((row.payload as PendingTaskPayload).awaitingTitle) {
      const task = await getPendingTask(row.id)
      if (task) return { id: row.id, task }
    }
  }
  return null
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
