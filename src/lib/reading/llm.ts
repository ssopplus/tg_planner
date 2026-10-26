import type { CefrLevel, ReadingLang, ReadingQuestion } from './types'

/**
 * LLM для тренажёра: перевод слова в контексте и вопросы к своим текстам.
 * Тот же OpenAI-совместимый API, что и парсинг задач (`LLM_*`), но модель
 * можно задать отдельно — `READING_LLM_MODEL`: для перевода хватает быстрой.
 * Ключ живёт только на сервере, в Mini App его нет.
 */

export function readingLlmAvailable(): boolean {
  return Boolean(process.env.LLM_API_KEY)
}

async function completeJson(
  system: string,
  user: string,
  maxTokens: number,
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) return null
  const baseUrl = process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1'
  const model = process.env.READING_LLM_MODEL ?? process.env.LLM_MODEL ?? 'openai/gpt-4o-mini'

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!response.ok) throw new Error(`LLM API error: ${response.status}`)
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content
  if (!content) return null
  // Модели иногда оборачивают JSON в ```json … ``` даже при json_object.
  const json = content.replace(/^```(?:json)?\s*|\s*```$/g, '')
  const parsed = JSON.parse(json) as unknown
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
}

export interface WordTranslation {
  base: string
  ru: string
}

/** Перевод английского слова так, как оно употреблено в предложении; учитывает фразовые глаголы. */
export async function translateWord(
  surface: string,
  sentence: string,
): Promise<WordTranslation | null> {
  const result = await completeJson(
    'You are an English–Russian dictionary for a language learner. Reply with JSON only.',
    `Translate the English word "${surface}" into Russian as it is used in this sentence: "${sentence}".
Reply with JSON: {"base": "dictionary form of the English word, or the phrasal verb/idiom if the word is part of one", "ru": "1-3 short Russian translations that fit this context, comma-separated"}`,
    200,
  )
  const base = typeof result?.base === 'string' ? result.base.trim().toLowerCase() : ''
  const ru = typeof result?.ru === 'string' ? result.ru.trim() : ''
  if (!ru) return null
  return { base: base || surface, ru: ru.slice(0, 300) }
}

export interface GeneratedQuiz {
  questions: ReadingQuestion[]
  level: CefrLevel | null
  glossary: Record<string, string> | null
}

/** Длиннее этого текст в промпт не идёт: вопросы по первым ~1500 словам и так проверяют понимание. */
const QUIZ_TEXT_LIMIT = 9000

/**
 * Четыре вопроса с вариантами к своему тексту. Для английского — ещё оценка
 * уровня CEFR и глоссарий трудных слов, чтобы клик по слову чаще находил
 * перевод без запроса.
 */
export async function generateQuiz(body: string, lang: ReadingLang): Promise<GeneratedQuiz | null> {
  const english = lang === 'en'
  const result = await completeJson(
    'You write reading-comprehension quizzes. Reply with JSON only.',
    `Text (${english ? 'English' : 'Russian'}):
"""
${body.slice(0, QUIZ_TEXT_LIMIT)}
"""

Write exactly 4 multiple-choice questions that check understanding of the main ideas and key facts of this text, not trivia. Each question has 4 options, exactly one correct. Write questions and options in ${english ? 'English' : 'Russian'}.
Reply with JSON: {"questions": [{"q": "...", "options": ["...", "...", "...", "..."], "answer": <index of the correct option, 0-3>}]${
      english
        ? `, "level": "B1" | "B2" | "C1" (CEFR level of the text), "glossary": {"<word as it appears in the text, lowercase>": "<short Russian translation in this context>"} with 15-25 words a B1 learner may not know`
        : ''
    }}`,
    english ? 2200 : 1400,
  )
  if (!result || !Array.isArray(result.questions)) return null

  const questions: ReadingQuestion[] = []
  for (const item of result.questions) {
    if (!item || typeof item !== 'object') continue
    const q = item as Record<string, unknown>
    const options = Array.isArray(q.options) ? q.options.filter((o) => typeof o === 'string') : []
    if (typeof q.q !== 'string' || options.length < 2) continue
    if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= options.length) continue
    questions.push({ q: q.q, options: options as string[], answer: Math.trunc(q.answer) })
  }
  if (!questions.length) return null

  const level =
    result.level === 'B1' || result.level === 'B2' || result.level === 'C1' ? result.level : null
  let glossary: Record<string, string> | null = null
  if (result.glossary && typeof result.glossary === 'object') {
    glossary = {}
    for (const [word, ru] of Object.entries(result.glossary as Record<string, unknown>)) {
      if (typeof ru === 'string' && ru.trim()) glossary[word.toLowerCase().trim()] = ru.trim()
    }
  }
  return { questions: questions.slice(0, 4), level, glossary }
}
