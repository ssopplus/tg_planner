import { createHash } from 'node:crypto'
import { Context, InlineKeyboard } from 'grammy'
import { BotContext } from '../middleware/user'
import { miniAppUrl } from '@/lib/telegram/mini-app-url'
import { applyGrade, countDueCards, nextDueCard } from '@/lib/reading/repo'
import {
  extractFromFile,
  ImportError,
  isImportableFile,
  MAX_IMPORT_BYTES,
} from '@/lib/reading/import/files'
import { fetchArticle } from '@/lib/reading/import/url'
import { describeImport, fileSourceKey, saveImported } from '@/lib/reading/import/save'
import { countWords } from '@/lib/reading/text-utils'
import type { CardGrade } from '@/lib/reading/types'
import {
  CHAT_REVIEW_LIMIT,
  decodeStart,
  encodeStart,
  finishReview,
  READING_CALLBACK_PREFIX,
  readingSummary,
  reviewBack,
  reviewFront,
  statsMessage,
} from '../services/reading'

/**
 * «Темп чтения» в боте: /read со сводкой, повторение карточек кнопками и
 * приём текстов — файл книги, ссылка на статью или пересланный длинный пост.
 */

/** Пересланное короче этого — скорее задача, чем текст для чтения. */
const FORWARD_MIN_WORDS = 120

const BARE_URL = /^\s*(https?:\/\/\S+)\s*$/i

export async function handleReadCommand(ctx: Context) {
  const { dbUser } = ctx as BotContext
  const settings = (dbUser.settings ?? {}) as Record<string, unknown>
  const summary = await readingSummary(dbUser.id, dbUser.timezone, settings.reading)
  const { text, keyboard } = statsMessage(summary)
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard })
}

async function showMessage(ctx: Context, text: string, keyboard: InlineKeyboard) {
  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
  } catch {
    // Сообщение слишком старое для правки или текст не изменился — шлём новое.
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard })
  }
}

/** Показать следующую карточку прохода или итог, если пора заканчивать. */
async function showNext(ctx: Context, done: number, start: string) {
  const { dbUser } = ctx as BotContext
  const card = done < CHAT_REVIEW_LIMIT ? await nextDueCard(dbUser.id) : null
  if (!card) {
    const result = await finishReview(dbUser.id, dbUser.timezone, done, decodeStart(start))
    await showMessage(ctx, result.text, result.keyboard)
    return
  }
  const due = await countDueCards(dbUser.id)
  const view = reviewFront(card, done, start, due)
  await showMessage(ctx, view.text, view.keyboard)
}

/**
 * Кнопки повторения: `rd:s` — начать, `rd:a:<id>:<n>:<t>` — показать перевод,
 * `rd:g:<id>:<оценка>:<n>:<t>` — оценить, `rd:x:<n>:<t>` — закончить.
 * `n` — сколько уже повторено в проходе, `t` — его начало (для длительности).
 */
export async function handleReadingCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data
  if (!data?.startsWith(READING_CALLBACK_PREFIX)) return false
  const { dbUser } = ctx as BotContext
  const [, action, ...args] = data.split(':')

  switch (action) {
    case 's': {
      await ctx.answerCallbackQuery()
      await showNext(ctx, 0, encodeStart(Date.now()))
      return true
    }
    case 'a': {
      const [id, n, start] = args
      const done = Number(n) || 0
      const card = await nextDueCard(dbUser.id)
      // Карточку могли уже оценить в Mini App — тогда просто идём дальше.
      if (!card || card.id !== id) {
        await ctx.answerCallbackQuery()
        await showNext(ctx, done, start)
        return true
      }
      const due = await countDueCards(dbUser.id)
      const view = reviewBack(card, done, start, due)
      await ctx.answerCallbackQuery()
      await showMessage(ctx, view.text, view.keyboard)
      return true
    }
    case 'g': {
      const [id, g, n, start] = args
      const grade = Number(g)
      if (grade !== 0 && grade !== 1 && grade !== 2) {
        await ctx.answerCallbackQuery()
        return true
      }
      const graded = await applyGrade(dbUser.id, id, grade as CardGrade)
      await ctx.answerCallbackQuery(grade === 0 ? { text: 'Вернётся через 10 минут' } : undefined)
      await showNext(ctx, (Number(n) || 0) + (graded ? 1 : 0), start)
      return true
    }
    case 'x': {
      const [n, start] = args
      await ctx.answerCallbackQuery()
      const result = await finishReview(
        dbUser.id,
        dbUser.timezone,
        Number(n) || 0,
        decodeStart(start),
      )
      await showMessage(ctx, result.text, result.keyboard)
      return true
    }
    default:
      await ctx.answerCallbackQuery()
      return true
  }
}

function importedKeyboard(): InlineKeyboard | undefined {
  const url = miniAppUrl('/reading/texts')
  return url ? new InlineKeyboard().webApp('📖 Открыть тексты', url) : undefined
}

async function replyImportError(ctx: Context, error: unknown) {
  if (error instanceof ImportError) {
    await ctx.reply(`📖 ${error.message}`)
    return
  }
  console.error('Ошибка импорта текста в боте:', error)
  await ctx.reply('📖 Не получилось сохранить текст — попробуйте ещё раз или через Mini App.')
}

/** Файл книги или документа → тексты тренажёра. Остальные документы бот не трогает. */
export async function handleReadingDocument(ctx: Context) {
  const doc = ctx.message?.document
  if (!doc) return
  const name = doc.file_name ?? ''
  if (!isImportableFile(name)) {
    await ctx.reply(
      'Из файлов я понимаю только книги и тексты для «Темпа чтения»: .fb2, .fb2.zip, .epub, .pdf, .txt.',
    )
    return
  }
  if ((doc.file_size ?? 0) > MAX_IMPORT_BYTES) {
    await ctx.reply('📖 Файл больше 4 МБ — сожмите в .fb2.zip или разбейте на части.')
    return
  }

  const { dbUser } = ctx as BotContext
  await ctx.replyWithChatAction('typing')
  try {
    const file = await ctx.api.getFile(doc.file_id)
    const response = await fetch(
      `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`,
    )
    if (!response.ok) throw new Error(`Telegram file ${response.status}`)
    const data = new Uint8Array(await response.arrayBuffer())
    const extracted = await extractFromFile(name, data)
    const saved = await saveImported(dbUser.id, {
      ...extracted,
      source: 'bot',
      sourceKey: fileSourceKey(data),
    })
    await ctx.reply(`📖 ${describeImport(saved)}`, { reply_markup: importedKeyboard() })
  } catch (error) {
    await replyImportError(ctx, error)
  }
}

/**
 * Текст для чтения в обычном сообщении: голая ссылка или пересланный длинный
 * пост. Возвращает `true`, если сообщение забрано, — тогда оно не уходит в
 * разбор задач.
 */
export async function handleReadingText(ctx: Context, text: string): Promise<boolean> {
  const { dbUser } = ctx as BotContext
  const url = BARE_URL.exec(text)?.[1]
  if (url) {
    await ctx.replyWithChatAction('typing')
    try {
      const article = await fetchArticle(url)
      const saved = await saveImported(dbUser.id, {
        title: article.title,
        body: article.body,
        source: 'bot',
        sourceKey: article.url,
      })
      await ctx.reply(`📖 ${describeImport(saved)}`, { reply_markup: importedKeyboard() })
    } catch (error) {
      await replyImportError(ctx, error)
    }
    return true
  }

  const forwarded = Boolean(ctx.message?.forward_origin)
  if (!forwarded || countWords(text) < FORWARD_MIN_WORDS) return false
  try {
    const firstLine = text.trim().split('\n')[0].trim()
    const title = firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine
    const saved = await saveImported(dbUser.id, {
      title,
      body: text,
      source: 'bot',
      sourceKey: `tg:${createHash('sha256').update(text).digest('hex').slice(0, 32)}`,
    })
    await ctx.reply(
      `📖 ${describeImport(saved)}\n\nПересланный длинный текст я сохраняю для чтения. Нужна была задача — напишите её своими словами.`,
      { reply_markup: importedKeyboard() },
    )
  } catch (error) {
    await replyImportError(ctx, error)
  }
  return true
}
