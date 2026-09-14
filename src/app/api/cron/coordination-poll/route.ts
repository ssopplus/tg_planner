import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, coordinationPolls } from '@/lib/db/schema'
import { bot } from '@/bot'
import {
  ensureTodayPoll,
  isWeekday,
  renderPoll,
  todayInTz,
} from '@/bot/services/coordination'
import { alreadyLoggedNote } from '@/bot/handlers/coordination'

/**
 * Ежедневный опрос по координации (очередь INTCOORD).
 *
 * Дейли и созвоны нигде не оставляют следа, который можно замерить, но в норму
 * дня входят — поэтому спрашиваем о них сами, по будням в конце рабочего дня.
 * Дальше опрос живёт на кнопках (см. src/bot/handlers/coordination.ts), а
 * подтверждённые суммы уходят в Трекер через учёт времени.
 *
 * Крон дёргается каждые 15 минут, роут сам решает, чей сейчас час: окно ±7
 * минут вокруг POLL_TIME в таймзоне пользователя — как у дайджестов.
 * Повторный вызов в то же окно ничего не дублирует: опрос за день один
 * (уникальный индекс user_id + poll_date), а уже отправленный не пересылается.
 */
const POLL_TIME = '18:00'
const WINDOW_MINUTES = 7

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.YANDEX_TRACKER_TOKEN
  const orgId = process.env.YANDEX_TRACKER_ORG_ID
  if (!token || !orgId) {
    return NextResponse.json({ error: 'tracker not configured' }, { status: 500 })
  }

  const url = new URL(request.url)
  /** ?force=1 — прислать опрос вне окна и вне будней (для проверки руками). */
  const force = url.searchParams.get('force') === '1'

  const now = new Date()
  const allUsers = await db.select().from(users)

  let sent = 0
  let skipped = 0
  const details: string[] = []

  for (const user of allUsers) {
    try {
      if (!force) {
        if (!isWeekday(user.timezone, now)) {
          skipped++
          continue
        }
        const local = new Intl.DateTimeFormat('en-GB', {
          timeZone: user.timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(now)
        if (!isTimeInWindow(local, POLL_TIME, WINDOW_MINUTES)) {
          skipped++
          continue
        }
      }

      if (!user.telegramId) {
        skipped++
        continue
      }

      const created = await ensureTodayPoll(user, { token, orgId })
      if (!created) {
        // Все регулярные направления за сегодня уже списаны — спрашивать нечего.
        details.push(`${user.id}: всё списано за ${todayInTz(user.timezone)}`)
        skipped++
        continue
      }

      const { poll, alreadyLogged } = created
      if (poll.messageId) {
        // Опрос за сегодня уже отправлен — второй раз не шлём.
        skipped++
        continue
      }

      const { text, keyboard } = renderPoll(poll)
      const note = alreadyLoggedNote(alreadyLogged)
      const message = await bot.api.sendMessage(
        user.telegramId.toString(),
        note ? `${text}\n\n(${note})` : text,
        { reply_markup: keyboard },
      )

      await db
        .update(coordinationPolls)
        .set({ chatId: String(message.chat.id), messageId: message.message_id })
        .where(eq(coordinationPolls.id, poll.id))

      sent++
    } catch (error) {
      console.error(`Ошибка опроса координации для пользователя ${user.id}:`, error)
      details.push(`${user.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, details })
}

/** Попадает ли `currentTime` в окно ±`windowMinutes` от `targetTime` (HH:MM). */
function isTimeInWindow(currentTime: string, targetTime: string, windowMinutes: number): boolean {
  const [curH, curM] = currentTime.split(':').map(Number)
  const [tarH, tarM] = targetTime.split(':').map(Number)
  const diff = Math.abs(curH * 60 + curM - (tarH * 60 + tarM))
  return diff <= windowMinutes || diff >= 1440 - windowMinutes
}
