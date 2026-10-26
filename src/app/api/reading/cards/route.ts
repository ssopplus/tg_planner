import { NextRequest, NextResponse } from 'next/server'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { upsertCard } from '@/lib/reading/repo'

/**
 * POST /api/reading/cards — слово в карточки. Повторное слово не дублируется:
 * у существующей карточки добавляется встреченная словоформа.
 */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as {
    en?: unknown
    ru?: unknown
    ctx?: unknown
    surface?: unknown
  }
  const en = typeof body.en === 'string' ? body.en.trim().slice(0, 100) : ''
  const ru = typeof body.ru === 'string' ? body.ru.trim().slice(0, 300) : ''
  if (!en || !ru) return NextResponse.json({ error: 'Нужны слово и перевод' }, { status: 400 })

  const card = await upsertCard(user.id, {
    en,
    ru,
    ctx: typeof body.ctx === 'string' ? body.ctx.slice(0, 1000) : '',
    surface: typeof body.surface === 'string' ? body.surface.slice(0, 100) : null,
  })
  return NextResponse.json(card, { status: 201 })
}
