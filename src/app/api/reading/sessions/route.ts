import { NextRequest, NextResponse } from 'next/server'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { recordSession } from '@/lib/reading/repo'
import { parseSessionInput } from '@/lib/reading/session-input'

/** POST /api/reading/sessions — записать тренировку. */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const checked = parseSessionInput(await request.json().catch(() => null))
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })

  const session = await recordSession(user.id, checked.value)
  return NextResponse.json(session, { status: 201 })
}
