import { NextRequest, NextResponse } from 'next/server'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { loadCards, loadSessions } from '@/lib/reading/repo'

/** GET /api/reading/state — тренировки за ~год и все карточки: одна загрузка на раздел. */
export async function GET(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [sessions, cards] = await Promise.all([loadSessions(user.id), loadCards(user.id)])
  return NextResponse.json({ sessions, cards })
}
