/**
 * Алгоритм автоприоритета (скоринг задач).
 * Чем выше score — тем важнее задача.
 */

interface ScoredTask {
  id: string
  title: string
  priority: string
  deadlineAt: Date | null
  deadlineType: string | null
  createdAt: Date
  overdueCount: number
  [key: string]: unknown
}

export function calculateScore(task: ScoredTask): number {
  let score = 0
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const endOfWeek = new Date(today)
  endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()))

  if (task.deadlineAt) {
    const deadline = new Date(task.deadlineAt)
    const deadlineDay = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate())

    if (deadlineDay < today) {
      // Просрочено
      score += 90
    } else if (deadlineDay.getTime() === today.getTime()) {
      // Сегодня
      score += task.deadlineType === 'HARD' ? 100 : 80
    } else if (deadlineDay.getTime() === tomorrow.getTime()) {
      // Завтра
      score += task.deadlineType === 'HARD' ? 70 : 55
    } else if (deadlineDay <= endOfWeek) {
      // Эта неделя
      score += 40
    } else {
      // Далёкий дедлайн
      score += 15
    }
  }

  // Ручной приоритет
  if (task.priority === 'HIGH') score += 50
  else if (task.priority === 'MEDIUM') score += 30
  else if (task.priority === 'LOW') score += 10

  // Давность: +5 за каждый день с момента создания (макс +30)
  const ageInDays = Math.floor((now.getTime() - task.createdAt.getTime()) / (1000 * 60 * 60 * 24))
  score += Math.min(ageInDays * 5, 30)

  // Штраф за частые переносы
  score += task.overdueCount * 10

  return score
}

/**
 * Сортирует задачи по score (убывание).
 */
export function sortByScore<T extends ScoredTask>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => calculateScore(b) - calculateScore(a))
}
