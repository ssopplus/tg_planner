import { NextResponse } from 'next/server'
import { purgeExpiredPendingTasks } from '@/bot/services/pending-store'

/**
 * Cron endpoint для очистки просроченных pending_tasks.
 * Vercel Cron: каждые 5 минут.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const removed = await purgeExpiredPendingTasks()
  return NextResponse.json({ ok: true, removed })
}
