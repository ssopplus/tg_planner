import { Priority, DeadlineType } from '../types'

export interface PendingTask {
  title: string
  description?: string
  projectId: string
  priority?: Priority
  deadlineAt?: Date
  deadlineType?: DeadlineType
  recurrence?: string
  createdAt: number // timestamp для TTL
}

/**
 * Временное хранение распарсенных задач до подтверждения.
 * In-memory Map с автоочисткой по TTL (5 минут).
 */
const PENDING_TTL = 5 * 60 * 1000 // 5 минут

export const pendingTasks = new Map<string, PendingTask>()

/**
 * Добавить задачу в ожидание подтверждения.
 * Возвращает уникальный ID.
 */
export function addPendingTask(task: Omit<PendingTask, 'createdAt'>): string {
  const id = crypto.randomUUID().slice(0, 8) // Короткий ID для callback data
  pendingTasks.set(id, { ...task, createdAt: Date.now() })
  return id
}

// Автоочистка устаревших записей каждую минуту
setInterval(() => {
  const now = Date.now()
  for (const [id, task] of pendingTasks) {
    if (now - task.createdAt > PENDING_TTL) {
      pendingTasks.delete(id)
    }
  }
}, 60_000)
