import { NextRequest, NextResponse } from 'next/server'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { applyDecision, type DecisionInput } from '@/lib/cockpit/requests'

/**
 * POST /api/cockpit/requests/:id — решение из Mini App.
 * Тело: `{ behavior: 'allow', always? }`, `{ behavior: 'deny', message? }`
 * или `{ answers: { вопрос: метка } }`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await request.json()) as Record<string, unknown>
  let input: DecisionInput
  if (body.answers && typeof body.answers === 'object') {
    input = { answers: Object.fromEntries(Object.entries(body.answers).map(([q, a]) => [q, String(a)])) }
  } else if (body.behavior === 'deny') {
    input = { behavior: 'deny', message: typeof body.message === 'string' ? body.message : undefined }
  } else if (body.behavior === 'allow') {
    input = { behavior: 'allow', always: body.always === true }
  } else {
    return NextResponse.json({ error: 'Нет решения' }, { status: 400 })
  }

  const res = await applyDecision(user.id, id, input)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 })
  return NextResponse.json({ ok: true, complete: res.complete })
}
