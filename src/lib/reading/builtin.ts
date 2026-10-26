import content from './content/texts.json'
import { countWords } from './text-utils'
import type { CefrLevel, ReadingLang, ReadingQuestion, ReadingText } from './types'

/**
 * Встроенные тексты с вопросами и глоссариями из прототипа. Едут в бандле
 * Mini App, а не в БД: они одни на всех и не меняются без деплоя.
 */

interface RawText {
  id: string
  lang: string
  level?: string
  title: string
  body: string
  glossary?: Record<string, string>
  questions?: ReadingQuestion[]
}

function toText(raw: RawText): ReadingText {
  return {
    id: raw.id,
    lang: raw.lang as ReadingLang,
    level: (raw.level as CefrLevel | undefined) ?? null,
    title: raw.title,
    body: raw.body,
    glossary: raw.glossary ?? null,
    questions: raw.questions ?? null,
    source: 'builtin',
    wordCount: countWords(raw.body),
  }
}

export const BUILTIN_TEXTS: ReadingText[] = [...content.ru, ...content.en].map(toText)

/** Служебные слова — их приглушает упражнение «Без голоса». */
export const FUNCTION_WORDS: Record<ReadingLang, ReadonlySet<string>> = {
  ru: new Set(content.functionWords.ru),
  en: new Set(content.functionWords.en),
}
