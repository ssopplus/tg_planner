import { Api, InlineKeyboard } from 'grammy'
import { and, eq, isNotNull, isNull, lt, ne } from 'drizzle-orm'
import { db } from '@/lib/db'
import { cockpitRequests } from '@/lib/db/schema'
import { miniAppUrl } from '@/lib/telegram/mini-app-url'
import { questionsOf, type CockpitRequest } from './requests'

/**
 * Напоминание в бот о запросе сессии, на который никто не ответил.
 *
 * Запросы в чат по умолчанию не пишутся (их слишком много, работа с ними — в
 * Mini App). Исключение — когда меня нет за машиной: запрос ждёт дольше
 * `WAIT_MS`, и к Маку столько же не прикасались (cockpit присылает
 * `idleSec`). Одно сообщение на запрос; когда запрос закрыт — где угодно, —
 * сообщение удаляется.
 *
 * Отдельный `Api`, а не бот целиком: синк приходит каждые несколько секунд, а
 * бот тянет за собой обработчики и AI-провайдер.
 */

export const WAIT_MS = 10 * 60e3

/** Кнопки: `ck:a:<id>` — разрешить, `ck:d:<id>` — отклонить, `ck:q:<id>:<n>` — вариант ответа. */
export const CALLBACK_PREFIX = 'ck:'

let api: Api | null = null
function botApi(): Api | null {
  if (!process.env.BOT_TOKEN) return null
  api ??= new Api(process.env.BOT_TOKEN)
  return api
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Вопрос, на который можно ответить кнопкой: один, без множественного выбора, до 4 вариантов. */
function buttonQuestion(req: CockpitRequest) {
  const qs = questionsOf(req)
  const q = qs.length === 1 ? qs[0] : null
  return q && !q.multiSelect && q.options.length <= 4 ? q : null
}

function noticeOf(req: CockpitRequest, now: number): { text: string; keyboard: InlineKeyboard } {
  const min = Math.round((now - req.createdAt.getTime()) / 60e3)
  const head = `⏳ <b>${esc(req.sessionName)}</b>${req.project ? ` · ${esc(req.project)}` : ''} ждёт ${min} мин`
  const keyboard = new InlineKeyboard()
  let body: string
  if (req.kind === 'question') {
    const qs = questionsOf(req)
    body = `❓ ${esc(qs[0]?.question ?? req.summary)}${qs.length > 1 ? `\n…и ещё ${qs.length - 1}` : ''}`
    const q = buttonQuestion(req)
    q?.options.forEach((o, i) => keyboard.text(o.label.slice(0, 60), `${CALLBACK_PREFIX}q:${req.id}:${i}`).row())
  } else {
    body = `🔐 <b>${esc(req.toolName)}</b>\n<code>${esc(req.summary.slice(0, 600))}</code>`
    keyboard.text('✅ Разрешить', `${CALLBACK_PREFIX}a:${req.id}`).text('❌ Отклонить', `${CALLBACK_PREFIX}d:${req.id}`).row()
  }
  const url = miniAppUrl(`/sessions/${req.sessionId}`)
  if (url) keyboard.webApp('Открыть в Mini App', url)
  return { text: `${head}\n\n${body}`, keyboard }
}

/**
 * Вызывается из синка: шлёт напоминания о давних запросах и убирает
 * сообщения о закрытых. Ошибки Telegram не роняют синк.
 */
export async function syncNotices(user: { id: string; telegramId: bigint }, idleSec: number | null) {
  const tg = botApi()
  if (!tg) return

  // Закрытые запросы: сообщение больше не нужно.
  const stale = await db
    .select()
    .from(cockpitRequests)
    .where(and(eq(cockpitRequests.userId, user.id), ne(cockpitRequests.status, 'pending'), isNotNull(cockpitRequests.messageId)))
  for (const r of stale) await dropNotice(r)

  if (idleSec === null || idleSec * 1000 < WAIT_MS) return
  const now = Date.now()
  const due = await db
    .select()
    .from(cockpitRequests)
    .where(
      and(
        eq(cockpitRequests.userId, user.id),
        eq(cockpitRequests.status, 'pending'),
        isNull(cockpitRequests.messageId),
        lt(cockpitRequests.createdAt, new Date(now - WAIT_MS)),
      ),
    )
  for (const r of due) {
    const { text, keyboard } = noticeOf(r, now)
    try {
      const msg = await tg.sendMessage(Number(user.telegramId), text, { parse_mode: 'HTML', reply_markup: keyboard })
      await db
        .update(cockpitRequests)
        .set({ chatId: String(msg.chat.id), messageId: msg.message_id })
        .where(eq(cockpitRequests.id, r.id))
    } catch (e) {
      console.error('[cockpit-notify] send', r.id, e)
    }
  }
}

/** Удаляет сообщение о запросе. Старше 48 ч Telegram удалять не даёт — тогда снимаем кнопки. */
export async function dropNotice(r: Pick<CockpitRequest, 'id' | 'chatId' | 'messageId'>) {
  const tg = botApi()
  if (!tg || !r.chatId || !r.messageId) return
  try {
    await tg.deleteMessage(r.chatId, r.messageId)
  } catch {
    await tg.editMessageReplyMarkup(r.chatId, r.messageId).catch(() => {})
  }
  await db.update(cockpitRequests).set({ chatId: null, messageId: null }).where(eq(cockpitRequests.id, r.id))
}
