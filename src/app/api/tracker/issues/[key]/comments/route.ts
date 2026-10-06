import { NextRequest, NextResponse } from 'next/server'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { addComment, listComments } from '@/lib/tracker/client'
import { trackerConfig, TRACKER_NOT_CONFIGURED } from '@/lib/tracker/config'

/** GET /api/tracker/issues/[key]/comments — обсуждение задачи. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const config = trackerConfig()
  if (!config) return NextResponse.json({ error: TRACKER_NOT_CONFIGURED }, { status: 503 })

  const { key } = await params
  try {
    const comments = await listComments({ ...config, issueKey: key })
    return NextResponse.json(
      comments.map((c) => ({
        id: c.id,
        text: c.text,
        author: c.createdBy?.display ?? 'без автора',
        createdAt: c.createdAt,
      })),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'неизвестная ошибка'
    return NextResponse.json({ error: `Трекер недоступен: ${message}` }, { status: 502 })
  }
}

/** POST /api/tracker/issues/[key]/comments — написать в задачу. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const config = trackerConfig()
  if (!config) return NextResponse.json({ error: TRACKER_NOT_CONFIGURED }, { status: 503 })

  const { key } = await params
  const body = (await request.json()) as { text?: string }
  const text = body.text?.trim()
  if (!text) return NextResponse.json({ error: 'Пустой комментарий' }, { status: 400 })

  try {
    const comment = await addComment({ ...config, issueKey: key, text })
    return NextResponse.json(
      {
        id: comment.id,
        text: comment.text,
        author: comment.createdBy?.display ?? 'я',
        createdAt: comment.createdAt,
      },
      { status: 201 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'неизвестная ошибка'
    return NextResponse.json({ error: `Комментарий не ушёл: ${message}` }, { status: 502 })
  }
}
