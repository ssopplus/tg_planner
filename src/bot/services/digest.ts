import { db } from '@/lib/db'
import { boards, tasks, users } from '@/lib/db/schema'
import { eq, and, lte, lt, gte, sql, isNotNull, isNull, inArray, or } from 'drizzle-orm'
import { bot } from '@/bot'
import { escapeMarkdown } from './markdown'
import { formatMinutes, readWorklogDay, todayInTz } from '@/lib/worklog/service'
import { miniAppUrl } from '@/lib/telegram/mini-app-url'
import { InlineKeyboard } from 'grammy'

/**
 * Утренний дайджест: две половины дня в одном сообщении.
 *
 * Сверху рабочее — что осталось в работе в Трекере, снизу личное — дела,
 * у которых срок сегодня или уже прошёл. Скоринга и автоподбора семи задач
 * больше нет: порядок задаёт сам пользователь на доске и в Трекере, а
 * дайджест только напоминает, что там лежит.
 */
export async function sendMorningDigest(user: typeof users.$inferSelect) {
  const timezone = user.timezone || 'Europe/Moscow'
  const today = todayInTz(timezone)

  const inWork = await db
    .select({ title: tasks.title, externalId: tasks.externalId })
    .from(tasks)
    .where(
      and(eq(tasks.userId, user.id), isNotNull(tasks.externalId), eq(tasks.status, 'IN_PROGRESS')),
    )
    .limit(10)

  // Личные дела: срок сегодня или раньше. Будущие не берём — утром они
  // только отвлекают, их место на доске в колонке «На неделе».
  const personal = await db
    .select({ title: tasks.title, dueDate: tasks.dueDate, emoji: boards.emoji })
    .from(tasks)
    .leftJoin(boards, eq(tasks.boardId, boards.id))
    .where(
      and(
        eq(tasks.userId, user.id),
        isNotNull(tasks.boardId),
        inArray(tasks.status, ['TODO', 'IN_PROGRESS']),
        lte(tasks.dueDate, today),
      ),
    )
    .limit(15)

  const lines: string[] = ['☀️ *Доброе утро*']

  if (inWork.length > 0) {
    lines.push('', `*В работе в Трекере (${inWork.length})*`)
    for (const task of inWork) {
      lines.push(`• \`${task.externalId}\` ${escapeMarkdown(trim(task.title, 44))}`)
    }
  }

  if (personal.length > 0) {
    const overdue = personal.filter((t) => t.dueDate && t.dueDate < today)
    lines.push('', `*Личные дела (${personal.length})*`)
    for (const task of personal.slice(0, 10)) {
      const mark = task.emoji ? `${task.emoji} ` : ''
      const late = task.dueDate && task.dueDate < today ? ' ⚠️' : ''
      lines.push(`• ${mark}${escapeMarkdown(trim(task.title, 42))}${late}`)
    }
    if (overdue.length > 0) {
      lines.push(`_Просрочено: ${overdue.length}_`)
    }
  }

  if (inWork.length === 0 && personal.length === 0) {
    lines.push('', 'Ни задач в работе, ни дел со сроком на сегодня. Свободный день 🎉')
  }

  await bot.api.sendMessage(user.telegramId.toString(), lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: openAppKeyboard(),
  })
}

/**
 * Вечерний итог: что закрыто и сколько времени списано.
 *
 * Списанные часы здесь главное: дайджест приходит в конце дня, и это
 * последний момент, когда пропущенное списание ещё можно вспомнить.
 */
export async function sendEveningDigest(user: typeof users.$inferSelect) {
  const timezone = user.timezone || 'Europe/Moscow'
  const today = todayInTz(timezone)
  const todayStart = new Date(`${today}T00:00:00`)

  const [{ count: completedToday }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(eq(tasks.userId, user.id), eq(tasks.status, 'DONE'), gte(tasks.completedAt, todayStart)),
    )

  const [{ count: overdue }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, user.id),
        inArray(tasks.status, ['TODO', 'IN_PROGRESS']),
        or(lt(tasks.dueDate, today), and(isNull(tasks.dueDate), lt(tasks.deadlineAt, todayStart))),
      ),
    )

  const spent = await readWorklogDay(user.id, today)
  const total = spent.reduce((sum, row) => sum + row.minutes, 0)

  const lines: string[] = ['🌙 *Итоги дня*', '']

  lines.push(
    total > 0
      ? `⏱ Списано: ${formatMinutes(total)} по ${pluralIssues(countIssues(spent))}`
      : '⏱ За сегодня ничего не списано',
  )

  if (total > 0 && total < 8 * 60) {
    lines.push(`_До нормы: ${formatMinutes(8 * 60 - total)}_`)
  }

  lines.push(completedToday > 0 ? `✅ Закрыто дел: ${completedToday}` : '✅ Дела не закрывались')

  if (overdue > 0) {
    lines.push(`⚠️ Просрочено: ${overdue}`)
  }

  await bot.api.sendMessage(user.telegramId.toString(), lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: openAppKeyboard('/tracker/time'),
  })
}

function openAppKeyboard(path = '/tracker') {
  const url = miniAppUrl(path)
  if (!url) return undefined
  return new InlineKeyboard().webApp(
    path === '/tracker/time' ? '⏱ Проверить время' : '📱 Открыть планировщик',
    url,
  )
}

function countIssues(rows: Array<{ issueKey: string }>): number {
  return new Set(rows.map((row) => row.issueKey)).size
}

function pluralIssues(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return `${count} задаче`
  return `${count} задачам`
}

function trim(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
