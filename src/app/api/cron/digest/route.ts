import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { sendMorningDigest, sendEveningDigest } from '@/bot/services/digest'

/**
 * Cron endpoint для отправки утренних и вечерних дайджестов.
 * Запускается каждые 15 минут, проверяет digest_time пользователей.
 */
export async function GET(request: Request) {
  // Проверка Vercel Cron секрета
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const allUsers = await db.select().from(users)

  let morningsSent = 0
  let eveningsSent = 0

  for (const user of allUsers) {
    try {
      // Вычисляем текущее время в timezone пользователя
      const userNow = new Date(
        now.toLocaleString('en-US', { timeZone: user.timezone }),
      )
      const userHour = userNow.getHours()
      const userMinute = userNow.getMinutes()
      const userTimeStr = `${String(userHour).padStart(2, '0')}:${String(userMinute).padStart(2, '0')}`

      // Парсим время дайджестов
      const morningTime = user.morningDigestTime
      const eveningTime = user.eveningDigestTime

      // Проверяем с допуском ±7 минут (cron раз в 15 мин)
      if (isTimeInWindow(userTimeStr, morningTime, 7)) {
        await sendMorningDigest(user)
        morningsSent++
      }

      if (isTimeInWindow(userTimeStr, eveningTime, 7)) {
        await sendEveningDigest(user)
        eveningsSent++
      }
    } catch (error) {
      console.error(`Ошибка дайджеста для пользователя ${user.id}:`, error)
    }
  }

  return NextResponse.json({
    ok: true,
    morningsSent,
    eveningsSent,
    totalUsers: allUsers.length,
  })
}

/**
 * Проверяет, попадает ли текущее время в окно ±windowMinutes от targetTime.
 */
function isTimeInWindow(currentTime: string, targetTime: string, windowMinutes: number): boolean {
  const [curH, curM] = currentTime.split(':').map(Number)
  const [tarH, tarM] = targetTime.split(':').map(Number)

  const curTotalMinutes = curH * 60 + curM
  const tarTotalMinutes = tarH * 60 + tarM

  const diff = Math.abs(curTotalMinutes - tarTotalMinutes)
  return diff <= windowMinutes || diff >= 1440 - windowMinutes // Учёт перехода через полночь
}
