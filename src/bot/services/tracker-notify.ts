import { InlineKeyboard } from 'grammy'
import { bot } from '@/bot'
import { miniAppUrl } from '@/lib/telegram/mini-app-url'
import { formatDate, type TaskChange } from '@/lib/tracker/changes'

/**
 * Уведомления в личку бота о том, что происходит с задачами Яндекс.Трекера.
 *
 * Три повода: задача появилась, задачу изменили (статус, дедлайн, приоритет,
 * заголовок, описание, новый комментарий), задачу закрыли. Все три приходят с
 * такта синка — раз в 30 минут, мгновенности тут нет и не предполагается.
 *
 * Разметка — HTML, а не Markdown, и каждый кусок текста из Трекера проходит
 * через `esc`. Тема тикета и комментарий пишутся людьми и спокойно содержат
 * `*`, `_`, `[`, `<`; в Markdown на таком ломается всё сообщение, а в HTML
 * достаточно экранировать три символа.
 *
 * Ключ задачи идёт отдельной строкой в `<code>`: в Telegram моноширинный
 * текст копируется касанием, и ключ можно сразу вставить в поиск, коммит или
 * ветку, не открывая Трекер.
 */

const TRACKER_BASE = 'https://tracker.yandex.ru'

/** Экранирование для parse_mode HTML — Telegram требует ровно эти три. */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Данные новой задачи, достаточные для формирования уведомления. */
export interface NewTaskNotice {
  /** UUID задачи в БД tg-planer (для deep-link в Mini App). */
  taskId: string
  /** Ключ тикета, например "POLAERP-194". */
  issueKey: string
  /** Заголовок (summary тикета). */
  title: string
  /** Имя проекта в tg-planer, куда легла задача. */
  projectName: string
  /** Статус словами Трекера. */
  status: string | null
  /** Дедлайн, если задан. */
  deadlineAt: Date | null
}

/**
 * Шапка сообщения: тема, ключ для копирования и поля задачи.
 *
 * Ключ стоит второй строкой, а не в заголовке: так он занимает всю строку и
 * в него легко попасть пальцем, чтобы скопировать.
 */
function issueCard(args: {
  issueKey: string
  title: string
  projectName?: string | null
  status?: string | null
  deadlineAt?: Date | null
}): string[] {
  const lines = [esc(args.title), `<code>${esc(args.issueKey)}</code>`]
  const facts: string[] = []
  if (args.projectName) facts.push(`Проект: ${esc(args.projectName)}`)
  if (args.status) facts.push(`Статус: ${esc(args.status)}`)
  if (args.deadlineAt) facts.push(`Дедлайн: ${formatDate(args.deadlineAt)}`)
  if (facts.length > 0) lines.push(facts.join('\n'))
  return lines
}

/** Одна строка описания задачи для сводного сообщения. */
function taskLine(t: NewTaskNotice): string {
  const parts = [`• <code>${esc(t.issueKey)}</code> ${esc(t.title)}`, `  проект: ${esc(t.projectName)}`]
  if (t.deadlineAt) parts.push(`  дедлайн: ${formatDate(t.deadlineAt)}`)
  return parts.join('\n')
}

/**
 * Кнопки под сообщением: карточка в Mini App и сам тикет в Трекере.
 *
 * Вторая кнопка нужна для того, чего в Mini App нет, — вложений, связей,
 * истории. Она не заменяет копируемый ключ: ключ чаще нужен не чтобы открыть
 * задачу, а чтобы упомянуть её в другом месте.
 */
function issueKeyboard(taskId: string, issueKey: string): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  const app = miniAppUrl(`/tracker/${taskId}`)
  if (app) keyboard.webApp('📱 Открыть', app)
  keyboard.url('🔗 В Трекере', `${TRACKER_BASE}/${issueKey}`)
  return keyboard
}

/**
 * Отправляет пользователю уведомление о новых задачах из Трекера.
 *
 * - 0 задач — ничего не делает.
 * - 1 задача — карточка с кнопками.
 * - N задач — одно сводное сообщение со списком (кнопки ведут на первую,
 *   клавиатура одна на сообщение; остальные открываются из Mini App).
 *
 * Ошибки отправки логируются, но не пробрасываются — сбой Telegram не должен
 * ронять синк (задачи в БД уже сохранены к этому моменту).
 */
export async function notifyNewTasks(
  telegramId: bigint | number,
  newTasks: NewTaskNotice[],
): Promise<void> {
  if (newTasks.length === 0) return

  const chatId = telegramId.toString()

  try {
    if (newTasks.length === 1) {
      const t = newTasks[0]
      const text = [
        '🆕 <b>Новая задача</b>',
        '',
        ...issueCard({
          issueKey: t.issueKey,
          title: t.title,
          projectName: t.projectName,
          status: t.status,
          deadlineAt: t.deadlineAt,
        }),
      ].join('\n')
      await bot.api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: issueKeyboard(t.taskId, t.issueKey),
      })
      return
    }

    const header = `🆕 <b>Новые задачи (${newTasks.length})</b>`
    const body = newTasks.map(taskLine).join('\n\n')
    await bot.api.sendMessage(chatId, `${header}\n\n${body}`, {
      parse_mode: 'HTML',
      reply_markup: issueKeyboard(newTasks[0].taskId, newTasks[0].issueKey),
    })
  } catch (error) {
    console.error('Ошибка отправки уведомления о новых задачах из Трекера:', error)
  }
}

/** Комментарий, о котором ещё не уведомляли. */
export interface CommentNotice {
  author: string
  text: string
}

/** Изменения одной задачи за такт синка. */
export interface TaskChangeNotice {
  taskId: string
  issueKey: string
  title: string
  changes: TaskChange[]
  comments: CommentNotice[]
}

/** Закрытая задача: тикет пропал из выборки активных. */
export interface ClosedTaskNotice {
  taskId: string
  issueKey: string
  title: string
}

/** Сколько изменившихся задач показываем по отдельности, не сводкой. */
const DETAILED_LIMIT = 5

/** Комментарий в уведомлении — одна-две строки, остальное в карточке. */
function commentLine(c: CommentNotice): string {
  const text = c.text.replace(/\s+/g, ' ').trim()
  const short = text.length > 160 ? `${text.slice(0, 159)}…` : text
  return `💬 ${esc(c.author)}: ${esc(short)}`
}

function changeMessage(notice: TaskChangeNotice): string {
  const lines = ['🔄 <b>Задача изменилась</b>', '', ...issueCard(notice)]
  lines.push('')
  for (const change of notice.changes) lines.push(esc(change.text))
  for (const comment of notice.comments) lines.push(commentLine(comment))
  return lines.join('\n')
}

/**
 * Уведомляет об изменениях в существующих задачах.
 *
 * До пяти задач — отдельным сообщением на каждую, с кнопками: изменение почти
 * всегда требует действия, и кнопка под ним экономит два касания. Больше пяти
 * — одна сводка, иначе бот устраивает очередь сообщений, которую никто не
 * читает.
 *
 * Ошибки отправки гасятся: задачи в БД уже обновлены, и падать из-за
 * Telegram синку незачем.
 */
export async function notifyTaskChanges(
  telegramId: bigint | number,
  notices: TaskChangeNotice[],
): Promise<void> {
  if (notices.length === 0) return
  const chatId = telegramId.toString()

  try {
    if (notices.length <= DETAILED_LIMIT) {
      for (const notice of notices) {
        await bot.api.sendMessage(chatId, changeMessage(notice), {
          parse_mode: 'HTML',
          reply_markup: issueKeyboard(notice.taskId, notice.issueKey),
        })
      }
      return
    }

    const header = `🔄 <b>Изменились задачи (${notices.length})</b>`
    const body = notices
      .map((n) => {
        const what = [...n.changes.map((c) => esc(c.text)), ...n.comments.map(commentLine)]
        return `• <code>${esc(n.issueKey)}</code> ${esc(n.title)}\n  ${what.join('\n  ')}`
      })
      .join('\n\n')
    await bot.api.sendMessage(chatId, `${header}\n\n${body}`, {
      parse_mode: 'HTML',
      reply_markup: issueKeyboard(notices[0].taskId, notices[0].issueKey),
    })
  } catch (error) {
    console.error('Ошибка отправки уведомления об изменениях задач Трекера:', error)
  }
}

/**
 * Уведомляет о закрытых задачах — тех, что пропали из выборки активных.
 *
 * Кнопка в Трекер остаётся: у закрытой задачи как раз чаще всего смотрят
 * резолюцию и последний комментарий.
 */
export async function notifyClosedTasks(
  telegramId: bigint | number,
  closed: ClosedTaskNotice[],
): Promise<void> {
  if (closed.length === 0) return
  const chatId = telegramId.toString()

  try {
    if (closed.length === 1) {
      const t = closed[0]
      const text = ['✅ <b>Задача закрыта</b>', '', ...issueCard(t)].join('\n')
      await bot.api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: issueKeyboard(t.taskId, t.issueKey),
      })
      return
    }
    const body = closed
      .map((t) => `• <code>${esc(t.issueKey)}</code> ${esc(t.title)}`)
      .join('\n')
    await bot.api.sendMessage(chatId, `✅ <b>Закрыты задачи (${closed.length})</b>\n\n${body}`, {
      parse_mode: 'HTML',
      reply_markup: issueKeyboard(closed[0].taskId, closed[0].issueKey),
    })
  } catch (error) {
    console.error('Ошибка отправки уведомления о закрытых задачах Трекера:', error)
  }
}
