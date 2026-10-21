import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, gt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { cockpitRequests, cockpitState } from '@/lib/db/schema'
import { authorizeMiniApp } from '@/lib/telegram/auth'

/**
 * GET /api/cockpit — экран «Сессии»: последний снимок dev-cockpit, ожидающие
 * запросы целиком и закрытые за последний час.
 */
export async function GET(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [state] = await db.select().from(cockpitState).where(eq(cockpitState.userId, user.id)).limit(1)
  const requests = await db
    .select({
      id: cockpitRequests.id,
      sessionId: cockpitRequests.sessionId,
      sessionName: cockpitRequests.sessionName,
      project: cockpitRequests.project,
      kind: cockpitRequests.kind,
      toolName: cockpitRequests.toolName,
      summary: cockpitRequests.summary,
      payload: cockpitRequests.payload,
      canAlways: cockpitRequests.canAlways,
      status: cockpitRequests.status,
      decision: cockpitRequests.decision,
      createdAt: cockpitRequests.createdAt,
    })
    .from(cockpitRequests)
    .where(and(eq(cockpitRequests.userId, user.id), gt(cockpitRequests.createdAt, new Date(Date.now() - 3600e3))))
    .orderBy(desc(cockpitRequests.createdAt))
    .limit(50)

  return NextResponse.json({
    syncedAt: state?.syncedAt ?? null,
    sessions: state?.sessions ?? [],
    requests,
  })
}
