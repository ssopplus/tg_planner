import { LLMProvider, ParsedTask, ParseContext } from './types'

/** Текущий провайдер — устанавливается при инициализации */
let currentProvider: LLMProvider | null = null

export function setLLMProvider(provider: LLMProvider) {
  currentProvider = provider
}

export function getLLMProvider(): LLMProvider | null {
  return currentProvider
}

/**
 * Парсинг нескольких задач из текста.
 * Если LLM недоступен — возвращает одну задачу как есть (только title).
 */
export async function parseTasksText(
  text: string,
  context: ParseContext,
): Promise<ParsedTask[]> {
  const provider = getLLMProvider()

  if (!provider) {
    return [{ title: text }]
  }

  try {
    const tasks = await provider.parseTasks(text, context)
    return tasks.length > 0 ? tasks : [{ title: text }]
  } catch (error) {
    console.error('Ошибка AI-парсинга, используем fallback:', error)
    return [{ title: text }]
  }
}

/**
 * Парсинг одной задачи — обёртка для обратной совместимости.
 */
export async function parseTaskText(
  text: string,
  context: ParseContext,
): Promise<ParsedTask> {
  const tasks = await parseTasksText(text, context)
  return tasks[0]
}
