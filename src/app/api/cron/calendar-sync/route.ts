import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { caldavConfig } from '@/lib/calendar/caldav'
import { markNotified, syncCalendar } from '@/lib/calendar/sync'
import {
  notifyCancelled,
  notifyInvitations,
  notifyMoved,
} from '@/bot/services/calendar-notify'

/**
 * Cron: встречи из Яндекс.Календаря по CalDAV.
 *
 * Такт — 15 минут: приглашение приходит в бот с такой задержкой, и этого
 * достаточно, потому что напоминаний «за N минут до начала» мы не шлём —
 * день показывается утренним дайджестом.
 *
 * Календарь может быть не подключён (нет пароля приложения) — это штатное
 * состояние, а не ошибка: роут отвечает 200 и говорит, что пропустил.
 */
async function resolveUser(): Promise<{
  id: string
  telegramId: bigint
  timezone: string
} | null> {
  const fromEnv = process.env.CALENDAR_SYNC_USER_ID ?? process.env.TRACKER_SYNC_USER_ID
  const columns = { id: users.id, telegramId: users.telegramId, timezone: users.timezone }
  if (fromEnv) {
    const [row] = await db.select(columns).from(users).where(eq(users.id, fromEnv)).limit(1)
    return row ?? null
  }
  const all = await db.select(columns).from(users).limit(2)
  return all.length === 1 ? all[0] : null
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!caldavConfig()) {
    return NextResponse.json({
      ok: true,
      skipped: 'календарь не подключён: нет YANDEX_CALDAV_LOGIN / YANDEX_CALDAV_PASSWORD',
    })
  }

  const user = await resolveUser()
  if (!user) {
    return NextResponse.json({ error: 'cannot resolve user' }, { status: 500 })
  }

  try {
    const result = await syncCalendar({ userId: user.id, timezone: user.timezone })
    if (!result) {
      return NextResponse.json({ ok: true, skipped: 'календарь не подключён' })
    }

    await notifyInvitations(user.telegramId, user.timezone, result.invited)
    await notifyMoved(user.telegramId, user.timezone, result.moved)
    await notifyCancelled(user.telegramId, user.timezone, result.cancelled)
    await markNotified(result.invited.map((m) => m.id))

    return NextResponse.json({
      ok: true,
      summary: {
        calendars: result.calendars,
        instances: result.instances,
        invited: result.invited.length,
        moved: result.moved.length,
        cancelled: result.cancelled.length,
        firstSync: result.firstSync,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'неизвестная ошибка'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
