import { NextRequest, NextResponse } from 'next/server'
import { and, asc, desc, eq, gt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { cockpitCommands, cockpitRequests, cockpitState, cockpitTranscripts } from '@/lib/db/schema'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { commandPayloadPublic } from '@/lib/cockpit/requests'

/**
 * GET /api/cockpit/sessions/:id — страница сессии в Mini App.
 *
 * Каждый вызов отмечает сессию как просматриваемую (`watched_at`): по этой
 * отметке dev-cockpit присылает её переписку, пока экран открыт. Первый раз
 * переписки ещё нет — она приедет ближайшими синками (до ~15 с).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const [transcript] = await db
    .insert(cockpitTranscripts)
    .values({ sessionId: id, userId: user.id, watchedAt: new Date() })
    .onConflictDoUpdate({ target: cockpitTranscripts.sessionId, set: { watchedAt: new Date() } })
    .returning()
  if (transcript.userId !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [state] = await db.select().from(cockpitState).where(eq(cockpitState.userId, user.id)).limit(1)
  const since = new Date(Date.now() - 3600e3)
  const requests = await db
    .select()
    .from(cockpitRequests)
    .where(
      and(eq(cockpitRequests.userId, user.id), eq(cockpitRequests.sessionId, id), eq(cockpitRequests.status, 'pending')),
    )
    // Старые сверху: новый запрос не сдвигает карточку, на которую уже нажимаешь.
    .orderBy(asc(cockpitRequests.createdAt))
  const commands = await db
    .select({
      id: cockpitCommands.id,
      kind: cockpitCommands.kind,
      sessionId: cockpitCommands.sessionId,
      payload: commandPayloadPublic,
      status: cockpitCommands.status,
      result: cockpitCommands.result,
      createdAt: cockpitCommands.createdAt,
    })
    .from(cockpitCommands)
    .where(and(eq(cockpitCommands.userId, user.id), eq(cockpitCommands.sessionId, id), gt(cockpitCommands.createdAt, since)))
    .orderBy(desc(cockpitCommands.createdAt))
    .limit(5)

  return NextResponse.json({
    session: state?.sessions.find((s) => s.id === id) ?? null,
    syncedAt: state?.syncedAt ?? null,
    items: transcript.items,
    transcriptAt: transcript.updatedAt,
    requests,
    commands,
  })
}
