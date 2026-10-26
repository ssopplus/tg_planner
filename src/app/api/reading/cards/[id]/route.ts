import { NextRequest, NextResponse } from 'next/server'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { applyGrade, deleteCard } from '@/lib/reading/repo'
import type { CardGrade } from '@/lib/reading/types'

/** PATCH /api/reading/cards/[id] — оценка при повторении; интервал считает сервер. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { grade } = (await request.json().catch(() => ({}))) as { grade?: unknown }
  if (grade !== 0 && grade !== 1 && grade !== 2) {
    return NextResponse.json({ error: 'Оценка — 0, 1 или 2' }, { status: 400 })
  }

  const card = await applyGrade(user.id, id, grade as CardGrade)
  if (!card) return NextResponse.json({ error: 'Карточка не найдена' }, { status: 404 })
  return NextResponse.json(card)
}

/** DELETE /api/reading/cards/[id] — убрать слово из словаря. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!(await deleteCard(user.id, id))) {
    return NextResponse.json({ error: 'Карточка не найдена' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
