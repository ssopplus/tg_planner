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
 * Парсинг задачи с fallback.
 * Если LLM недоступен — возвращает задачу как есть (только title).
 */
export async function parseTaskText(
  text: string,
  context: ParseContext,
): Promise<ParsedTask> {
  const provider = getLLMProvider()

  if (!provider) {
    return { title: text }
  }

  try {
    return await provider.parseTask(text, context)
  } catch (error) {
    console.error('Ошибка AI-парсинга, используем fallback:', error)
    return { title: text }
  }
}
