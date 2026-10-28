import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { cockpitRequests, cockpitState } from '@/lib/db/schema'
import { escapeMarkdown } from '@/bot/services/markdown'

/** Сколько задач плана показывать по проекту и сколько записей ворклога сессий. */
const PLAN_TOP = 3
const LOG_TOP = 6

function trim(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Блок dev-cockpit для утренней сводки и /today (Markdown): кто из сессий ждёт
 * меня, что сессии записали в ворклог за вчера и сегодня, первые задачи плана
 * по проектам. Пусто — cockpit ничего не присылал или всё спокойно.
 *
 * `dates` — дни ворклога (YYYY-MM-DD), которые считаются свежими.
 */
export async function cockpitDigestLines(userId: string, dates: string[]): Promise<string[]> {
  const [state] = await db
    .select({ sessions: cockpitState.sessions, plan: cockpitState.plan })
    .from(cockpitState)
    .where(eq(cockpitState.userId, userId))
    .limit(1)
  if (!state) return []

  const lines: string[] = []
  const pending = await db
    .select({ id: cockpitRequests.id })
    .from(cockpitRequests)
    .where(and(eq(cockpitRequests.userId, userId), eq(cockpitRequests.status, 'pending')))
  const waiting = state.sessions.filter((s) => s.status === 'waiting')
  if (pending.length || waiting.length) {
    lines.push('', `*Ждут тебя в Claude (${Math.max(pending.length, waiting.length)})*`)
    for (const s of waiting.slice(0, 5)) lines.push(`• ${escapeMarkdown(trim(s.name, 50))}`)
  }

  // Ворклог сессий: запись этой сессии за свежий день, по одной на задачу.
  const seen = new Set<string>()
  const logs: string[] = []
  for (const s of state.sessions) {
    for (const t of s.tasks ?? []) {
      const key = t.issue ?? t.title
      if (!t.log?.done || !dates.includes(t.log.date) || seen.has(key)) continue
      seen.add(key)
      logs.push(`• ${t.issue ? `\`${t.issue}\` ` : ''}${escapeMarkdown(trim(t.log.done.replace(/\s+/g, ' '), 110))}`)
    }
  }
  if (logs.length) {
    lines.push('', '*Сессии сделали*', ...logs.slice(0, LOG_TOP))
    if (logs.length > LOG_TOP) lines.push(`…и ещё ${logs.length - LOG_TOP}`)
  }

  const busy = new Set(state.sessions.flatMap((s) => [s.taskKey, ...(s.tasks ?? []).map((t) => t.issue)]).filter(Boolean))
  const plan: string[] = []
  for (const p of state.plan?.projects ?? []) {
    const byKey = new Map(p.issues.map((i) => [i.key, i]))
    const open = p.plan.filter((k) => {
      const i = byKey.get(k)
      return !i || !(i.resolved || i.status?.type === 'done' || i.status?.type === 'cancelled')
    })
    if (!open.length) continue
    plan.push(`_${escapeMarkdown(p.project)}_`)
    open.slice(0, PLAN_TOP).forEach((k, n) => {
      const i = byKey.get(k)
      const mark = busy.has(k) ? ' · ● в работе' : ''
      plan.push(`${n + 1}. \`${k}\` ${escapeMarkdown(trim(i?.summary ?? '', 50))}${mark}`)
    })
  }
  if (plan.length) lines.push('', '*План*', ...plan)

  return lines
}
