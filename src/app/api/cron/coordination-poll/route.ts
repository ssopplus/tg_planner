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
 * Роут сам решает, чей сейчас час, поэтому расписание крона от времени опроса
 * не зависит — менять надо только POLL_TIME.
 *
 * Условие отправки намеренно не «попали в узкое окно», а «уже не раньше
 * POLL_TIME, ещё не позже CUTOFF, и сегодня не отправляли»: пропущенный прогон
 * (сбой сети, лежащий планировщик, дрейф расписания на минуту) иначе съедал бы
 * опрос за весь день. Дублей это не создаёт — опрос за день один (уникальный
 * индекс user_id + poll_date), а уже отправленному проставлен message_id.
 */
const POLL_TIME = '18:00'
/** После этого часа спрашивать бессмысленно — день закончился. */
const CUTOFF_TIME = '23:00'

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
        if (!isWithinPollHours(local)) {
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

/** Наступило ли время опроса и не прошёл ли срок (HH:MM в таймзоне пользователя). */
export function isWithinPollHours(
  currentTime: string,
  from = POLL_TIME,
  to = CUTOFF_TIME,
): boolean {
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
  }
  const now = minutes(currentTime)
  return now >= minutes(from) && now < minutes(to)
}
