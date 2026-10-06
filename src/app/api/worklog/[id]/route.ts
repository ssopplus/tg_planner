import { NextRequest, NextResponse } from 'next/server'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { editWorklog, removeWorklog } from '@/lib/worklog/service'

/** PATCH /api/worklog/[id] — поправить длительность или комментарий. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await request.json()) as { minutes?: number; comment?: string }

  const result = await editWorklog({ userId: user.id, id, ...body })
  if (!result.ok) {
    const status = result.error === 'Запись не найдена' ? 404 : 502
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json(result.row)
}

/** DELETE /api/worklog/[id] — убрать списание из Трекера. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const result = await removeWorklog({ userId: user.id, id })
  if (!result.ok) {
    const status = result.error === 'Запись не найдена' ? 404 : 502
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ ok: true })
}
