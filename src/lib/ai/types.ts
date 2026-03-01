/** Результат парсинга задачи из текста */
export interface ParsedTask {
  title: string
  description?: string
  project?: string
  priority?: 'LOW' | 'MEDIUM' | 'HIGH'
  deadlineAt?: string // ISO date string
  deadlineType?: 'HARD' | 'SOFT'
  recurrence?: string // Описание повторения на русском
}

/** Контекст для AI-парсинга */
export interface ParseContext {
  currentDate: string
  timezone: string
  projects: string[]
}

/** Абстракция LLM-провайдера */
export interface LLMProvider {
  /** Парсинг задач из текста на естественном языке (может вернуть несколько) */
  parseTasks(text: string, context: ParseContext): Promise<ParsedTask[]>
}
