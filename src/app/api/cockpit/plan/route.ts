import { NextRequest, NextResponse } from 'next/server'
import { and, eq, gt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { cockpitCommands, cockpitState } from '@/lib/db/schema'
import { authorizeMiniApp } from '@/lib/telegram/auth'

const TASK_KEY_RE = /^[A-Z][A-Z0-9]{1,15}-\d{1,6}$/
const MAX_KEYS = 200

/**
 * GET /api/cockpit/plan — экран «План»: очерёдность задач по проектам из
 * dev-cockpit, сессии (чтобы показать, по каким задачам идёт работа) и правки
 * плана, которые cockpit ещё не применил.
 */
export async function GET(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [state] = await db.select().from(cockpitState).where(eq(cockpitState.userId, user.id)).limit(1)
  const commands = await db
    .select({ payload: cockpitCommands.payload, status: cockpitCommands.status, result: cockpitCommands.result })
    .from(cockpitCommands)
    .where(
      and(
        eq(cockpitCommands.userId, user.id),
        eq(cockpitCommands.kind, 'plan-set'),
        gt(cockpitCommands.createdAt, new Date(Date.now() - 3600e3)),
      ),
    )
    .orderBy(cockpitCommands.createdAt)

  return NextResponse.json({
    syncedAt: state?.syncedAt ?? null,
    plan: state?.plan ?? null,
    sessions: (state?.sessions ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      taskKey: s.taskKey ?? null,
      issues: (s.tasks ?? []).map((t) => t.issue).filter(Boolean),
      updatedAt: s.updatedAt,
    })),
    // По проекту — последняя правка: ждёт cockpit или не применилась.
    edits: Object.fromEntries(
      commands.map((c) => [String(c.payload.project), { status: c.status, error: c.result?.error ?? null }]),
    ),
  })
}

/**
 * POST /api/cockpit/plan `{ project, keys }` — новый порядок задач проекта.
 *
 * Сразу ложится в снимок (экран не ждёт cockpit) и уходит в cockpit командой
 * plan-set; там он сохраняется в data/plan.json, и следующий синк присылает
 * план уже из cockpit. Неотправленная прежняя правка того же проекта
 * отменяется: применять имеет смысл только последнюю.
 */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as { project?: unknown; keys?: unknown }
  const project = typeof body.project === 'string' ? body.project.trim().slice(0, 60) : ''
  if (!project || !Array.isArray(body.keys)) return NextResponse.json({ error: 'Нужны проект и задачи' }, { status: 400 })
  const keys = [...new Set(body.keys.map((k) => String(k).toUpperCase()))]
  if (keys.length > MAX_KEYS || keys.some((k) => !TASK_KEY_RE.test(k))) {
    return NextResponse.json({ error: 'Неверный список задач' }, { status: 400 })
  }

  const [state] = await db.select({ plan: cockpitState.plan }).from(cockpitState).where(eq(cockpitState.userId, user.id)).limit(1)
  const plan = state?.plan
  const entry = plan?.projects.find((p) => p.project === project)
  if (!plan || !entry) return NextResponse.json({ error: 'Проект не найден в плане cockpit' }, { status: 404 })
  entry.plan = keys
  await db.update(cockpitState).set({ plan }).where(eq(cockpitState.userId, user.id))

  await db
    .delete(cockpitCommands)
    .where(
      and(
        eq(cockpitCommands.userId, user.id),
        eq(cockpitCommands.kind, 'plan-set'),
        eq(cockpitCommands.status, 'pending'),
        sql`${cockpitCommands.payload}->>'project' = ${project}`,
      ),
    )
  await db.insert(cockpitCommands).values({ userId: user.id, kind: 'plan-set', payload: { project, keys } })

  return NextResponse.json({ ok: true, plan: keys })
}
