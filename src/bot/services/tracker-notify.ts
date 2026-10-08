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
 * Сообщения намеренно НЕ используют Markdown внутри заголовков задач:
 * summary из Трекера может содержать *, _, [, ] и ломать разметку.
 * Всё сообщение отправляется как plain text; кнопка ведёт на карточку
 * задачи в Mini App.
 */

/** Данные новой задачи, достаточные для формирования уведомления. */
export interface NewTaskNotice {
  /** UUID задачи в БД tg-planer (для deep-link в Mini App). */
  taskId: string
  /** Заголовок (summary тикета). */
  title: string
  /** Имя проекта в tg-planer, куда легла задача. */
  projectName: string
  /** Дедлайн, если задан. */
  deadlineAt: Date | null
}

/** Одна строка описания задачи для сводного/одиночного сообщения. */
function taskLine(t: NewTaskNotice): string {
  const parts = [`• ${t.title}`, `  проект: ${t.projectName}`]
  if (t.deadlineAt) parts.push(`  дедлайн: ${formatDate(t.deadlineAt)}`)
  return parts.join('\n')
}

/** Кнопка «Открыть» — ведёт на карточку конкретной задачи в Mini App. */
function openTaskKeyboard(taskId: string): InlineKeyboard | undefined {
  const url = miniAppUrl(`/tracker/${taskId}`)
  if (!url) return undefined
  return new InlineKeyboard().webApp('📱 Открыть', url)
}

/**
 * Отправляет пользователю уведомление о новых задачах из Трекера.
 *
 * - 0 задач — ничего не делает.
 * - 1 задача — короткое сообщение с кнопкой «Открыть» на эту задачу.
 * - N задач — одно сводное сообщение со списком (кнопка ведёт на первую,
 *   т.к. inline-кнопка одна на сообщение; из списка юзер откроет остальные
 *   в Mini App).
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
      const lines = [`🆕 Новая задача: ${t.title}`, `Проект: ${t.projectName}`]
      if (t.deadlineAt) lines.push(`Дедлайн: ${formatDate(t.deadlineAt)}`)
      await bot.api.sendMessage(chatId, lines.join('\n'), {
        reply_markup: openTaskKeyboard(t.taskId),
      })
      return
    }

    const header = `🆕 Новые задачи (${newTasks.length}):`
    const body = newTasks.map(taskLine).join('\n\n')
    await bot.api.sendMessage(chatId, `${header}\n\n${body}`, {
      reply_markup: openTaskKeyboard(newTasks[0].taskId),
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
  return `💬 ${c.author}: ${text.length > 160 ? `${text.slice(0, 159)}…` : text}`
}

function changeMessage(notice: TaskChangeNotice): string {
  const lines = [`🔄 ${notice.issueKey} · ${notice.title}`]
  for (const change of notice.changes) lines.push(change.text)
  for (const comment of notice.comments) lines.push(commentLine(comment))
  return lines.join('\n')
}

/**
 * Уведомляет об изменениях в существующих задачах.
 *
 * До пяти задач — отдельным сообщением на каждую, с кнопкой на карточку:
 * изменение почти всегда требует действия, и кнопка под ним экономит
 * два касания. Больше пяти — одна сводка, иначе бот устраивает очередь
 * сообщений, которую никто не читает.
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
          reply_markup: openTaskKeyboard(notice.taskId),
        })
      }
      return
    }

    const header = `🔄 Изменились задачи (${notices.length}):`
    const body = notices
      .map((n) => {
        const what = [...n.changes.map((c) => c.text), ...n.comments.map(commentLine)]
        return `• ${n.issueKey} ${n.title}\n  ${what.join('\n  ')}`
      })
      .join('\n\n')
    await bot.api.sendMessage(chatId, `${header}\n\n${body}`, {
      reply_markup: openTaskKeyboard(notices[0].taskId),
    })
  } catch (error) {
    console.error('Ошибка отправки уведомления об изменениях задач Трекера:', error)
  }
}

/**
 * Уведомляет о закрытых задачах — тех, что пропали из выборки активных.
 *
 * Кнопки «Открыть» тут нет: задача закрыта, идти в неё обычно незачем.
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
      await bot.api.sendMessage(chatId, `✅ Закрыта: ${t.issueKey} · ${t.title}`)
      return
    }
    const body = closed.map((t) => `• ${t.issueKey} ${t.title}`).join('\n')
    await bot.api.sendMessage(chatId, `✅ Закрыты задачи (${closed.length}):\n\n${body}`)
  } catch (error) {
    console.error('Ошибка отправки уведомления о закрытых задачах Трекера:', error)
  }
}
