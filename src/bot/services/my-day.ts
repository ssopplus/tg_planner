import { db } from '@/lib/db'
import { tasks, projects } from '@/lib/db/schema'
import { eq, and, lte, or, isNull, sql } from 'drizzle-orm'
import { sortByScore } from './scoring'

const MY_DAY_LIMIT = 7

/**
 * Получает задачи «Моего дня» для пользователя.
 * Автоматически формирует список из:
 * 1. Задачи с жёстким дедлайном сегодня (обязательные)
 * 2. Просроченные задачи
 * 3. Задачи с мягким дедлайном сегодня
 * 4. Задачи, вручную добавленные в «Мой день»
 * 5. Задачи с высоким приоритетом без даты
 */
export async function getMyDayTasks(userId: string) {
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59)

  // Получаем все активные задачи пользователя
  const allTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      priority: tasks.priority,
      deadlineAt: tasks.deadlineAt,
      deadlineType: tasks.deadlineType,
      myDayDate: tasks.myDayDate,
      overdueCount: tasks.overdueCount,
      createdAt: tasks.createdAt,
      projectName: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(tasks.userId, userId), eq(tasks.status, 'TODO')))

  // Категоризация
  const myDayTasks: typeof allTasks = []
  const otherTasks: typeof allTasks = []

  for (const task of allTasks) {
    const isManuallyAdded = task.myDayDate === todayStr
    const isOverdue = task.deadlineAt && task.deadlineAt < today && !isManuallyAdded
    const isDueToday = task.deadlineAt && task.deadlineAt <= endOfDay && task.deadlineAt >= today
    const isHighPriorityNoDue = task.priority === 'HIGH' && !task.deadlineAt

    if (isManuallyAdded || isOverdue || isDueToday || isHighPriorityNoDue) {
      myDayTasks.push(task)
    } else {
      otherTasks.push(task)
    }
  }

  // Сортировка по score
  const scored = sortByScore(
    myDayTasks.map((t) => ({
      ...t,
      deadlineType: t.deadlineType,
      overdueCount: t.overdueCount,
    })),
  )

  // Ограничение количества
  return scored.slice(0, MY_DAY_LIMIT)
}

/**
 * Добавить задачу в «Мой день».
 */
export async function addToMyDay(taskId: string) {
  const todayStr = new Date().toISOString().split('T')[0]
  await db.update(tasks).set({ myDayDate: todayStr }).where(eq(tasks.id, taskId))
}

/**
 * Убрать задачу из «Моего дня».
 */
export async function removeFromMyDay(taskId: string) {
  await db.update(tasks).set({ myDayDate: null }).where(eq(tasks.id, taskId))
}
