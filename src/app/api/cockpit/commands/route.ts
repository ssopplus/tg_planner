import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { cockpitCommands } from '@/lib/db/schema'
import { authorizeMiniApp } from '@/lib/telegram/auth'

const TASK_KEY_RE = /^[A-Z][A-Z0-9]{1,15}-\d{1,6}$/
const MAX_TEXT = 4000

/**
 * POST /api/cockpit/commands — команда локальному dev-cockpit из Mini App.
 *
 * - `{ kind: 'message', sessionId, text }` — текст в сессию. Claude получит его
 *   межсессионным сообщением с пометкой «[из dev-cockpit]».
 * - `{ kind: 'start-task', issueKey, title? }` — новая фоновая сессия
 *   `claude --bg "/start-task КЛЮЧ"` в ~/Разработка.
 *
 * Команда ждёт в БД, пока cockpit не заберёт её синком (раз в 10 с).
 */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as Record<string, unknown>
  let values: typeof cockpitCommands.$inferInsert
  if (body.kind === 'message') {
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (typeof body.sessionId !== 'string' || !text) {
      return NextResponse.json({ error: 'Нужны сессия и текст' }, { status: 400 })
    }
    values = { userId: user.id, kind: 'message', sessionId: body.sessionId, payload: { text: text.slice(0, MAX_TEXT) } }
  } else if (body.kind === 'start-task') {
    const issueKey = typeof body.issueKey === 'string' ? body.issueKey.trim().toUpperCase() : ''
    if (!TASK_KEY_RE.test(issueKey)) return NextResponse.json({ error: 'Неверный ключ задачи' }, { status: 400 })
    const title = typeof body.title === 'string' ? body.title.slice(0, 200) : ''
    values = { userId: user.id, kind: 'start-task', payload: { issueKey, title } }
  } else {
    return NextResponse.json({ error: 'Неизвестная команда' }, { status: 400 })
  }

  const [cmd] = await db.insert(cockpitCommands).values(values).returning({ id: cockpitCommands.id })
  return NextResponse.json({ ok: true, id: cmd.id })
}
