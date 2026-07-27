import { InlineKeyboard } from 'grammy'
import { bot } from '@/bot'

/**
 * Уведомления в личку бота о задачах, пришедших из Yandex Tracker при синке.
 *
 * Этап 1 (сделано): уведомление о НОВЫХ задачах (ветка created в синке).
 * Этап 2 (отложено): уведомления об изменениях существующих задач —
 *   закрытие тикета, смена дедлайна, смена приоритета. См.
 *   Документация/Проекты/Личное/tg-planer/tasks.md.
 *
 * Сообщения намеренно НЕ используют Markdown внутри заголовков задач:
 * summary из Трекера может содержать *, _, [, ] и ломать разметку.
 * Всё сообщение отправляется как plain text; кнопка ведёт на страницу
 * задачи в Mini App (роут /tasks/<id>).
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

/** Форматирует дату дедлайна как "дд.мм.гггг" (локаль ru, только дата). */
function formatDeadline(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}.${month}.${year}`
}

/** Одна строка описания задачи для сводного/одиночного сообщения. */
function taskLine(t: NewTaskNotice): string {
  const parts = [`• ${t.title}`, `  проект: ${t.projectName}`]
  if (t.deadlineAt) parts.push(`  дедлайн: ${formatDeadline(t.deadlineAt)}`)
  return parts.join('\n')
}

/** Кнопка «Открыть» — ведёт на страницу конкретной задачи в Mini App. */
function openTaskKeyboard(taskId: string): InlineKeyboard | undefined {
  const base = process.env.WEBAPP_URL
  if (!base) return undefined
  const url = `${base.replace(/\/$/, '')}/tasks/${taskId}`
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
      if (t.deadlineAt) lines.push(`Дедлайн: ${formatDeadline(t.deadlineAt)}`)
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
