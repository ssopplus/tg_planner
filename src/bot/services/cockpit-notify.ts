import { InlineKeyboard } from 'grammy'
import { bot } from '@/bot'
import { miniAppUrl } from '@/lib/telegram/mini-app-url'
import { questionsOf, type CockpitRequest } from '@/lib/cockpit/requests'
import { requestBody } from '@/lib/cockpit/format'
import type { CockpitSessionSnapshot } from '@/lib/db/schema'

/**
 * Сообщения бота о сессиях Claude Code из dev-cockpit: запрос разрешения,
 * вопрос Claude и «сессия закончила».
 *
 * callback_data: `ck:a:<id>` разрешить, `ck:A:<id>` разрешить всегда,
 * `ck:d:<id>` отклонить, `ck:q:<id>:<вопрос>:<вариант>` ответ на вопрос.
 */

/** Сколько входа инструмента влезает в сообщение. Длиннее — только в Mini App. */
const MAX_BODY = 2500

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function header(req: CockpitRequest, icon: string, title: string): string {
  const project = req.project ? ` · ${esc(req.project)}` : ''
  return `${icon} <b>${title}</b>${project}\nСессия: <b>${esc(req.sessionName)}</b>`
}

/** Первый вопрос, на который ещё нет ответа; null — отвечены все. */
function nextQuestionIndex(req: CockpitRequest): number | null {
  const answers = req.decision?.answers ?? {}
  const i = questionsOf(req).findIndex((q) => answers[q.question] === undefined)
  return i === -1 ? null : i
}

export function formatRequest(req: CockpitRequest): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard()
  const appUrl = miniAppUrl('/sessions')
  let text: string

  if (req.kind === 'question') {
    const answers = req.decision?.answers ?? {}
    const lines = questionsOf(req).map((q) => {
      const head = q.header ? `<b>${esc(q.header)}.</b> ` : ''
      const answered = answers[q.question]
      if (answered !== undefined) return `${head}${esc(q.question)}\n→ <i>${esc(answered)}</i>`
      const opts = q.options.map((o) => `• ${esc(o.label)}${o.description ? ` — ${esc(o.description)}` : ''}`)
      return `${head}${esc(q.question)}${q.multiSelect ? ' <i>(один вариант)</i>' : ''}\n${opts.join('\n')}`
    })
    text = `${header(req, '❓', 'Вопрос Claude')}\n\n${lines.join('\n\n')}`
    const qi = nextQuestionIndex(req)
    if (qi !== null && req.status === 'pending') {
      questionsOf(req)[qi].options.forEach((o, oi) => {
        keyboard.text(o.label.slice(0, 60), `ck:q:${req.id}:${qi}:${oi}`).row()
      })
      keyboard.text('❌ Отклонить', `ck:d:${req.id}`)
    }
  } else {
    const body = requestBody(req.toolName, req.payload)
    const truncated = body.length > MAX_BODY
    const shown = truncated ? `${body.slice(0, MAX_BODY)}\n…` : body
    text =
      `${header(req, '🔐', 'Запрос разрешения')}\nИнструмент: <code>${esc(req.toolName)}</code>` +
      (typeof req.payload.description === 'string' ? `\n<i>${esc(req.payload.description)}</i>` : '') +
      `\n\n<pre>${esc(shown)}</pre>`
    if (req.status === 'pending') {
      // Разрешать обрезанное нельзя: SQL и команды должны быть видны целиком.
      if (truncated) text += '\n\n<i>Вход длинный — целиком и с кнопкой «Разрешить» в Mini App.</i>'
      else {
        keyboard.text('✅ Разрешить', `ck:a:${req.id}`)
        if (req.canAlways) keyboard.text('♾ Всегда', `ck:A:${req.id}`)
      }
      keyboard.text('❌ Отклонить', `ck:d:${req.id}`)
    }
  }
  if (req.status === 'pending' && appUrl) keyboard.row().webApp('📱 Сессии', appUrl)
  return { text, keyboard }
}

/** Отправляет новый запрос; возвращает координаты сообщения для правок. */
export async function sendRequest(
  telegramId: bigint,
  req: CockpitRequest,
): Promise<{ chatId: string; messageId: number }> {
  const { text, keyboard } = formatRequest(req)
  const msg = await bot.api.sendMessage(telegramId.toString(), text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  })
  return { chatId: String(msg.chat.id), messageId: msg.message_id }
}

/** Итог по запросу — строкой под сообщением. */
export function outcomeLabel(req: CockpitRequest, cockpitStatus?: string): string {
  if (cockpitStatus === 'answered-elsewhere') return '🖥 Ответили в VS Code'
  if (cockpitStatus === 'expired' || cockpitStatus === 'closed') return '⌛ Истекло — ответить можно в VS Code'
  if (cockpitStatus === 'answered') return '💻 Ответили в dev-cockpit'
  if (req.decision?.behavior === 'deny') return '❌ Отклонено'
  if (req.kind === 'question') return '✅ Ответ отправлен'
  return req.decision?.always ? '♾ Разрешено всегда' : '✅ Разрешено'
}

/**
 * Перерисовывает сообщение запроса. Закрытый запрос теряет кнопки и получает
 * строку итога; вопрос с частью ответов — кнопки следующего вопроса.
 */
export async function refreshRequestMessage(req: CockpitRequest, outcome?: string): Promise<void> {
  if (!req.chatId || !req.messageId) return
  const { text, keyboard } = formatRequest(req)
  try {
    await bot.api.editMessageText(req.chatId, req.messageId, outcome ? `${text}\n\n${outcome}` : text, {
      parse_mode: 'HTML',
      reply_markup: outcome ? undefined : keyboard,
    })
  } catch (e) {
    // «message is not modified» и удалённое сообщение — не повод ронять синк.
    console.warn('[cockpit] не удалось обновить сообщение', req.id, (e as Error).message)
  }
}

/** «Сессия закончила»: последний ответ Claude, чтобы понять, нужно ли что-то делать. */
export async function notifySessionDone(telegramId: bigint, s: CockpitSessionSnapshot): Promise<void> {
  const project = s.project ? ` · ${esc(s.project)}` : ''
  const last = s.lastAssistant ? `\n\n${esc(s.lastAssistant.slice(0, 700))}` : ''
  await bot.api.sendMessage(telegramId.toString(), `✅ <b>${esc(s.name)}</b> закончила${project}${last}`, {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  })
}
