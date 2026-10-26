import { createHash } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { readingTexts } from '@/lib/db/schema'
import { chunkText } from '../chunk'
import { estimateLevel } from '../level'
import { countWords, MIN_CUSTOM_WORDS, normalizeText } from '../text-utils'
import type { ReadingLang, ReadingTextSource } from '../types'
import { ImportError } from './files'

/** Язык по буквам: кириллицы больше латиницы — русский. */
export function detectLang(text: string): ReadingLang {
  const sample = text.slice(0, 20_000)
  const cyrillic = (sample.match(/[а-яё]/gi) ?? []).length
  const latin = (sample.match(/[a-z]/gi) ?? []).length
  return cyrillic >= latin ? 'ru' : 'en'
}

/** Ключ дубля для файла: одинаковое содержимое — тот же текст, как бы файл ни назывался. */
export function fileSourceKey(data: Uint8Array): string {
  return `file:${createHash('sha256').update(data).digest('hex').slice(0, 32)}`
}

export interface SavedImport {
  title: string
  lang: ReadingLang
  parts: number
  words: number
  firstId: string
  truncated: boolean
  duplicate: boolean
}

/**
 * Сохраняет импортированный текст: нормализует, режет на части по 400–800
 * слов, у английского оценивает уровень. Повторный импорт той же ссылки или
 * того же файла возвращает уже сохранённое.
 */
export async function saveImported(
  userId: string,
  input: {
    title: string
    body: string
    source: Exclude<ReadingTextSource, 'builtin' | 'paste'>
    sourceKey: string
    lang?: ReadingLang
  },
): Promise<SavedImport> {
  const existing = await db
    .select({
      id: readingTexts.id,
      title: readingTexts.title,
      lang: readingTexts.lang,
      parts: readingTexts.parts,
      collection: readingTexts.collection,
      words: readingTexts.wordCount,
    })
    .from(readingTexts)
    .where(and(eq(readingTexts.userId, userId), eq(readingTexts.sourceUrl, input.sourceKey)))
    .orderBy(asc(readingTexts.part))
  if (existing.length) {
    return {
      title: existing[0].collection ?? existing[0].title,
      lang: existing[0].lang === 'en' ? 'en' : 'ru',
      parts: existing.length,
      words: existing.reduce((sum, r) => sum + r.words, 0),
      firstId: existing[0].id,
      truncated: false,
      duplicate: true,
    }
  }

  const body = normalizeText(input.body)
  const words = countWords(body)
  if (words < MIN_CUSTOM_WORDS) {
    throw new ImportError(
      `В тексте ${words} слов — для тренировки нужно не меньше ${MIN_CUSTOM_WORDS}`,
    )
  }
  const lang = input.lang ?? detectLang(body)
  const title = input.title.trim().slice(0, 200) || 'Без названия'
  const { parts, truncated } = chunkText(body)
  const multi = parts.length > 1

  const rows = await db
    .insert(readingTexts)
    .values(
      parts.map((part, i) => ({
        userId,
        lang,
        level: lang === 'en' ? estimateLevel(part) : null,
        title: multi ? `${title} · ${i + 1}/${parts.length}` : title,
        body: part,
        wordCount: countWords(part),
        source: input.source,
        sourceUrl: input.sourceKey,
        collection: multi ? title : null,
        part: i + 1,
        parts: parts.length,
      })),
    )
    .returning({ id: readingTexts.id })

  return {
    title,
    lang,
    parts: parts.length,
    words,
    firstId: rows[0].id,
    truncated,
    duplicate: false,
  }
}

/** Сообщение об итоге импорта — одно для Mini App и для бота. */
export function describeImport(saved: SavedImport): string {
  if (saved.duplicate) return `«${saved.title}» уже в библиотеке`
  const lang = saved.lang === 'en' ? 'английский' : 'русский'
  const parts = saved.parts > 1 ? `, ${saved.parts} частей` : ''
  const cut = saved.truncated ? ' Книга длинная — сохранено начало.' : ''
  return `Добавлено: «${saved.title}» — ${saved.words} слов, ${lang}${parts}.${cut}`
}
