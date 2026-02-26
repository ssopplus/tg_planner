import { OpenAICompatibleProvider } from './openai-provider'
import { setLLMProvider } from './provider'

/**
 * Инициализация LLM-провайдера.
 * По умолчанию — OpenRouter (OpenAI-compatible API).
 */
export function initAI() {
  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_MODEL ?? 'openai/gpt-4o-mini'
  const baseUrl = process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1'

  if (apiKey) {
    setLLMProvider(new OpenAICompatibleProvider(apiKey, model, baseUrl))
  } else {
    console.warn('LLM_API_KEY не задан — AI-парсинг отключён, задачи создаются как есть')
  }
}
