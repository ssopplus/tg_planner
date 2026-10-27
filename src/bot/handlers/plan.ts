import { Context, InlineKeyboard } from 'grammy'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { cockpitState } from '@/lib/db/schema'
import { BotContext } from '../middleware/user'
import { escapeMarkdown } from '../services/markdown'
import { miniAppUrl } from '@/lib/telegram/mini-app-url'

/** Сколько задач плана показывать по проекту — остальное в Mini App. */
const PER_PROJECT = 10

/**
 * /plan — план задач из dev-cockpit: по каждому проекту задачи в том порядке,
 * в каком их собираются делать. Одним сообщением, без правки — менять порядок
 * удобнее в Mini App, туда ведёт кнопка под списком.
 */
export async function handlePlanCommand(ctx: Context) {
  const { dbUser } = ctx as BotContext
  const [state] = await db
    .select({ plan: cockpitState.plan, sessions: cockpitState.sessions })
    .from(cockpitState)
    .where(eq(cockpitState.userId, dbUser.id))
    .limit(1)

  const url = miniAppUrl('/plan')
  const keyboard = url ? new InlineKeyboard().webApp('🗂 Открыть план', url) : undefined
  const projects = state?.plan?.projects.filter((p) => p.plan.length) ?? []

  if (!projects.length) {
    await ctx.reply(
      state?.plan
        ? 'План пуст. Задачи в него добавляются в Mini App или на вкладке «План» dev-cockpit.'
        : 'dev-cockpit ещё не присылал план.',
      { reply_markup: keyboard },
    )
    return
  }

  const notes = state!.plan!.notes
  const working = new Set(
    state!.sessions
      .filter((s) => s.status === 'busy' || s.status === 'waiting')
      .flatMap((s) => [s.taskKey, ...(s.tasks ?? []).map((t) => t.issue)])
      .filter(Boolean),
  )

  const lines: string[] = []
  for (const p of projects) {
    const byKey = new Map(p.issues.map((i) => [i.key, i]))
    lines.push(`*${escapeMarkdown(p.project)}*`)
    p.plan.slice(0, PER_PROJECT).forEach((key, n) => {
      const i = byKey.get(key)
      const closed = i && (i.resolved || i.status?.type === 'done' || i.status?.type === 'cancelled')
      const note = notes[key]
      const tail = [
        i?.status?.display,
        note ? `☑ ${note.done}/${note.total}` : null,
        working.has(key) ? '● в работе у Claude' : null,
      ]
        .filter(Boolean)
        .map((x) => escapeMarkdown(String(x)))
        .join(' · ')
      const title = escapeMarkdown(trim(i?.summary || '', 60))
      lines.push(`${n + 1}. ${closed ? '✓ ' : ''}\`${key}\` ${title}${tail ? ` — ${tail}` : ''}`)
    })
    if (p.plan.length > PER_PROJECT) lines.push(`…и ещё ${p.plan.length - PER_PROJECT}`)
    lines.push('')
  }

  await ctx.reply(lines.join('\n').trim(), { parse_mode: 'Markdown', reply_markup: keyboard })
}

function trim(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
