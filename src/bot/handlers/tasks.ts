import { Context, InlineKeyboard } from 'grammy'
import { db } from '@/lib/db'
import { tasks, projects } from '@/lib/db/schema'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { BotContext } from '../middleware/user'
import { escapeMarkdown } from '../services/markdown'
import { miniAppUrl } from '@/lib/telegram/mini-app-url'
import { formatMinutes, readWorklogDay, todayInTz } from '@/lib/worklog/service'

/**
 * /tasks — рабочие задачи из Яндекс.Трекера.
 *
 * Одним сообщением, а не по сообщению на задачу: список читают целиком, а
 * десяток отдельных сообщений с кнопками забивает переписку. Открыть задачу
 * можно кнопкой под списком — она ведёт в Mini App, где есть и списание
 * времени, и смена статуса.
 */
export async function handleTasks(ctx: Context) {
  const { dbUser } = ctx as BotContext
  const timezone = dbUser.timezone || 'Europe/Moscow'

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      externalId: tasks.externalId,
      projectName: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(tasks.userId, dbUser.id),
        isNotNull(tasks.externalId),
        inArray(tasks.status, ['TODO', 'IN_PROGRESS']),
      ),
    )
    .limit(30)

  if (rows.length === 0) {
    await ctx.reply('Активных задач Трекера нет.')
    return
  }

  // Списанное за сегодня берём из зеркала: в списке важно, что по задаче
  // уже есть время, а не точная до минуты сверка с Трекером.
  const spent = await readWorklogDay(dbUser.id, todayInTz(timezone))
  const byIssue: Record<string, number> = {}
  for (const row of spent) byIssue[row.issueKey] = (byIssue[row.issueKey] ?? 0) + row.minutes

  const inWork = rows.filter((r) => r.status === 'IN_PROGRESS')
  const open = rows.filter((r) => r.status === 'TODO')

  const lines: string[] = []
  if (inWork.length > 0) {
    lines.push('*В работе*')
    for (const row of inWork) lines.push(formatLine(row, byIssue))
    lines.push('')
  }
  if (open.length > 0) {
    lines.push('*Открытые*')
    for (const row of open.slice(0, 15)) lines.push(formatLine(row, byIssue))
    if (open.length > 15) lines.push(`…и ещё ${open.length - 15}`)
  }

  const url = miniAppUrl('/tracker')
  const keyboard = url ? new InlineKeyboard().webApp('🗂 Открыть Трекер', url) : undefined

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown', reply_markup: keyboard })
}

function formatLine(
  row: { title: string; externalId: string | null; projectName: string | null },
  spentByIssue: Record<string, number>,
): string {
  const spent = row.externalId ? spentByIssue[row.externalId] : undefined
  const time = spent ? ` · ${formatMinutes(spent)}` : ''
  const project = row.projectName ? ` · ${escapeMarkdown(row.projectName)}` : ''
  return `• \`${row.externalId}\` ${escapeMarkdown(trim(row.title, 44))}${time}${project}`
}

function trim(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
