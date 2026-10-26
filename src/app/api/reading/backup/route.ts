import { NextRequest, NextResponse } from 'next/server'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { restoreBackup } from '@/lib/reading/backup'

export const maxDuration = 60

/** POST /api/reading/backup — восстановить из JSON-копии; слияние без дублей. */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = await request.json().catch(() => null)
  try {
    const result = await restoreBackup(user.id, raw)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Копия не восстановилась'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
