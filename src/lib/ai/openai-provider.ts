import { LLMProvider, ParsedTask, ParseContext } from './types'
import { buildParsePrompt, buildParseUserMessage } from './prompts/parse-task'

/**
 * OpenAI-compatible LLM провайдер.
 * Работает с любым API, совместимым с OpenAI (OpenRouter, OpenAI, Together и т.д.).
 */
export class OpenAICompatibleProvider implements LLMProvider {
  private apiKey: string
  private model: string
  private baseUrl: string

  constructor(apiKey: string, model = 'openai/gpt-4o-mini', baseUrl = 'https://openrouter.ai/api/v1') {
    this.apiKey = apiKey
    this.model = model
    this.baseUrl = baseUrl
  }

  async parseTasks(text: string, context: ParseContext): Promise<ParsedTask[]> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildParsePrompt(context) },
          { role: 'user', content: buildParseUserMessage(text) },
        ],
        temperature: 0.1,
        max_tokens: 600,
      }),
    })

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      throw new Error('Пустой ответ от LLM')
    }

    const parsed = JSON.parse(content)

    // LLM может вернуть массив напрямую или объект с ключом tasks
    const tasksArray: ParsedTask[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.tasks)
        ? parsed.tasks
        : [parsed]

    // Валидация: title обязателен
    return tasksArray.filter((t) => t.title && t.title.trim() !== '')
  }
}
