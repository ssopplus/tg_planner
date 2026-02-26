/** Приоритеты задач */
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH'

/** Типы дедлайнов */
export type DeadlineType = 'HARD' | 'SOFT'

/** Результат AI-парсинга */
export interface ParsedTask {
  title: string
  description?: string
  project?: string
  priority?: Priority
  deadlineAt?: Date
  deadlineType?: DeadlineType
}
