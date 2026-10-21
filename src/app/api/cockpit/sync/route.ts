import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { cockpitCommands, cockpitRequests, cockpitState, type CockpitSessionSnapshot } from '@/lib/db/schema'
import { resolveCockpitUser, type CockpitRequest } from '@/lib/cockpit/requests'

/**
 * POST /api/cockpit/sync — обмен с локальным dev-cockpit.
 *
 * Cockpit живёт на рабочей машине и ходит сюда сам: присылает снимок сессий,
 * ожидающие запросы и итоги закрытых, а в ответ получает решения, принятые в
 * Mini App, и команды («написать в сессию», «запустить задачу»). Входящих
 * соединений на машину нет.
 *
 * В чат бота ничего не пишется: запросов от десятка сессий слишком много,
 * вся работа с ними — в разделе «Сессии» Mini App.
 *
 * Побеждает первый ответ. Решение отсюда доходит до сессии только через
 * cockpit; если он успел закрыть запрос сам (ответили в VS Code или в его UI),
 * решение из Mini App отбрасывается.
 */

interface IncomingRequest {
  id: string
  sessionId: string
  sessionName: string
  project?: string | null
  kind: 'permission' | 'question'
  toolName: string
  summary: string
  payload: Record<string, unknown>
  canAlways?: boolean
  createdAt: number
}

interface SyncBody {
  /** Нет поля — снимок не менялся (лёгкий опрос), обновляется только время синка. */
  sessions?: CockpitSessionSnapshot[]
  pending?: IncomingRequest[]
  /** Закрытые в cockpit: answered | answered-elsewhere | expired | closed. */
  closed?: { id: string; status: string }[]
  /** Итоги выполненных команд из Mini App. */
  commandResults?: { id: string; ok: boolean; error?: string; output?: string }[]
}

/** Команда, которую cockpit забрал, но так и не отчитался, — считаем потерянной. */
const COMMAND_LOST_MS = 5 * 60e3

const RETENTION_MS = 7 * 24 * 3600e3

export async function POST(request: NextRequest) {
  const secret = process.env.COCKPIT_SECRET
  if (!secret) return NextResponse.json({ error: 'COCKPIT_SECRET не задан' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await resolveCockpitUser()
  if (!user) return NextResponse.json({ error: 'Пользователь не определён' }, { status: 500 })

  const body = (await request.json()) as SyncBody
  const pending = Array.isArray(body.pending) ? body.pending : []
  const closed = Array.isArray(body.closed) ? body.closed : []

  // --- снимок сессий ---
  if (Array.isArray(body.sessions)) {
    const sessions = body.sessions
    await db
      .insert(cockpitState)
      .values({ userId: user.id, sessions, syncedAt: new Date() })
      .onConflictDoUpdate({ target: cockpitState.userId, set: { sessions, syncedAt: new Date() } })
  } else {
    await db.update(cockpitState).set({ syncedAt: new Date() }).where(eq(cockpitState.userId, user.id))
  }

  // --- запросы ---
  const incomingIds = [...pending.map((r) => r.id), ...closed.map((c) => c.id)]
  const open = or(eq(cockpitRequests.status, 'pending'), and(eq(cockpitRequests.status, 'answered'), isNull(cockpitRequests.deliveredAt)))
  const rows = await db
    .select()
    .from(cockpitRequests)
    .where(
      and(
        eq(cockpitRequests.userId, user.id),
        incomingIds.length ? or(open, inArray(cockpitRequests.id, incomingIds)) : open,
      ),
    )
  const byId = new Map(rows.map((r) => [r.id, r]))
  const isUndelivered = (r: CockpitRequest) => r.status === 'answered' && r.decision && !r.deliveredAt

  for (const inc of pending) {
    if (byId.has(inc.id)) continue
    await db
      .insert(cockpitRequests)
      .values({
        id: inc.id,
        userId: user.id,
        sessionId: inc.sessionId,
        sessionName: inc.sessionName.slice(0, 200),
        project: inc.project ?? null,
        kind: inc.kind === 'question' ? 'question' : 'permission',
        toolName: inc.toolName,
        summary: inc.summary.slice(0, 500),
        payload: inc.payload ?? {},
        canAlways: Boolean(inc.canAlways),
        createdAt: new Date(inc.createdAt),
      })
      .onConflictDoNothing()
  }

  const finish = (r: CockpitRequest, status: string) =>
    db
      .update(cockpitRequests)
      .set({ status, answeredAt: r.answeredAt ?? new Date() })
      .where(eq(cockpitRequests.id, r.id))

  const closedIds = new Set<string>()
  for (const c of closed) {
    closedIds.add(c.id)
    const r = byId.get(c.id)
    if (!r) continue
    const status = c.status === 'closed' ? 'expired' : c.status
    // Pending — или решение из Mini App ещё не забрали, а cockpit уже закрыл запрос сам.
    if (r.status === 'pending' || (isUndelivered(r) && c.status !== 'answered')) await finish(r, status)
  }

  // Cockpit перезапускался и забыл запрос — ждать ответа на него больше некому.
  const pendingIds = new Set(pending.map((r) => r.id))
  for (const r of rows) {
    if (pendingIds.has(r.id) || closedIds.has(r.id)) continue
    if (r.status === 'pending' || isUndelivered(r)) await finish(r, 'expired')
  }

  // --- решения для cockpit ---
  const ready = rows.filter((r) => isUndelivered(r) && pendingIds.has(r.id))
  if (ready.length) {
    await db
      .update(cockpitRequests)
      .set({ deliveredAt: new Date() })
      .where(inArray(cockpitRequests.id, ready.map((r) => r.id)))
  }

  // --- команды из Mini App ---
  for (const res of Array.isArray(body.commandResults) ? body.commandResults : []) {
    await db
      .update(cockpitCommands)
      .set({
        status: res.ok ? 'done' : 'failed',
        result: { error: res.error?.slice(0, 1000), output: res.output?.slice(0, 2000) },
        doneAt: new Date(),
      })
      .where(and(eq(cockpitCommands.id, res.id), eq(cockpitCommands.userId, user.id)))
  }
  await db
    .update(cockpitCommands)
    .set({ status: 'failed', result: { error: 'cockpit не отчитался о выполнении' }, doneAt: new Date() })
    .where(
      and(
        eq(cockpitCommands.userId, user.id),
        eq(cockpitCommands.status, 'sent'),
        lt(cockpitCommands.sentAt, new Date(Date.now() - COMMAND_LOST_MS)),
      ),
    )
  const commands = await db
    .update(cockpitCommands)
    .set({ status: 'sent', sentAt: new Date() })
    .where(and(eq(cockpitCommands.userId, user.id), eq(cockpitCommands.status, 'pending')))
    .returning({
      id: cockpitCommands.id,
      kind: cockpitCommands.kind,
      sessionId: cockpitCommands.sessionId,
      payload: cockpitCommands.payload,
    })

  const retention = new Date(Date.now() - RETENTION_MS)
  await db.delete(cockpitRequests).where(lt(cockpitRequests.createdAt, retention))
  await db.delete(cockpitCommands).where(lt(cockpitCommands.createdAt, retention))

  return NextResponse.json({ decisions: ready.map((r) => ({ id: r.id, decision: r.decision })), commands })
}
