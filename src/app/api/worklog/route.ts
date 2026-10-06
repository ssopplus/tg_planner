import { NextRequest, NextResponse } from 'next/server'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import {
  createWorklog,
  formatMinutes,
  readWorklogDay,
  syncWorklogDay,
  todayInTz,
  WORKDAY_MINUTES,
} from '@/lib/worklog/service'

/**
 * GET /api/worklog?date=YYYY-MM-DD — списания за день.
 *
 * По умолчанию перечитывает день из Трекера: время могли списать и мимо
 * приложения. `?fresh=0` отдаёт зеркало из БД — этим пользуется список задач,
 * которому нужны только суммы и не нужен лишний поход в API.
 */
export async function GET(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const timezone = user.timezone || 'Europe/Moscow'
  const day = searchParams.get('date') || todayInTz(timezone)
  const fresh = searchParams.get('fresh') !== '0'

  try {
    const rows = fresh
      ? await syncWorklogDay({ userId: user.id, timezone, day })
      : await readWorklogDay(user.id, day)

    const total = rows.reduce((sum, row) => sum + row.minutes, 0)
    return NextResponse.json({
      day,
      rows,
      total,
      totalLabel: formatMinutes(total),
      remaining: Math.max(WORKDAY_MINUTES - total, 0),
      remainingLabel: formatMinutes(Math.max(WORKDAY_MINUTES - total, 0)),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'неизвестная ошибка'
    return NextResponse.json({ error: `Трекер недоступен: ${message}` }, { status: 502 })
  }
}

/** POST /api/worklog — списать время в задачу. */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const timezone = user.timezone || 'Europe/Moscow'
  const body = (await request.json()) as {
    issueKey?: string
    issueTitle?: string
    minutes?: number
    comment?: string
    date?: string
  }

  if (!body.issueKey) return NextResponse.json({ error: 'Не указана задача' }, { status: 400 })
  if (!body.minutes) return NextResponse.json({ error: 'Не указана длительность' }, { status: 400 })

  const result = await createWorklog({
    userId: user.id,
    timezone,
    day: body.date || todayInTz(timezone),
    issueKey: body.issueKey,
    issueTitle: body.issueTitle ?? null,
    minutes: body.minutes,
    comment: body.comment ?? '',
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })
  return NextResponse.json(result.row, { status: 201 })
}
