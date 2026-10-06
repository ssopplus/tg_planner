import { NextRequest, NextResponse } from 'next/server'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { executeTransition, listTransitions } from '@/lib/tracker/client'
import { trackerConfig, TRACKER_NOT_CONFIGURED } from '@/lib/tracker/config'

/**
 * GET /api/tracker/issues/[key]/transitions — куда задачу можно перевести.
 *
 * Список зависит от очереди и текущего статуса, поэтому берётся у Трекера
 * каждый раз, а не хранится в приложении.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const config = trackerConfig()
  if (!config) return NextResponse.json({ error: TRACKER_NOT_CONFIGURED }, { status: 503 })

  const { key } = await params
  try {
    const transitions = await listTransitions({ ...config, issueKey: key })
    return NextResponse.json(
      transitions.map((t) => ({ id: t.id, display: t.display, to: t.to.display })),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'неизвестная ошибка'
    return NextResponse.json({ error: `Трекер недоступен: ${message}` }, { status: 502 })
  }
}

/** POST /api/tracker/issues/[key]/transitions — выполнить переход. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const config = trackerConfig()
  if (!config) return NextResponse.json({ error: TRACKER_NOT_CONFIGURED }, { status: 503 })

  const { key } = await params
  const body = (await request.json()) as {
    transitionId?: string
    fields?: Record<string, unknown>
  }
  if (!body.transitionId) {
    return NextResponse.json({ error: 'Не указан переход' }, { status: 400 })
  }

  const result = await executeTransition({
    ...config,
    issueKey: key,
    transitionId: body.transitionId,
    fields: body.fields,
  })

  if (!result.ok) {
    // 422 от Трекера обычно значит незаполненное обязательное поле очереди —
    // показываем его текст целиком, иначе причина отказа теряется.
    return NextResponse.json({ error: result.reason ?? 'Трекер отказал' }, { status: 422 })
  }

  // После перехода отдаём новый список: следующий шаг зависит от нового статуса.
  try {
    const transitions = await listTransitions({ ...config, issueKey: key })
    return NextResponse.json({
      ok: true,
      transitions: transitions.map((t) => ({ id: t.id, display: t.display, to: t.to.display })),
    })
  } catch {
    return NextResponse.json({ ok: true, transitions: [] })
  }
}
