import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { cockpitCommands } from '@/lib/db/schema'
import { authorizeMiniApp } from '@/lib/telegram/auth'

const TASK_KEY_RE = /^[A-Z][A-Z0-9]{1,15}-\d{1,6}$/
const MAX_TEXT = 4000

/** Скрины приходят data-URL'ами, уже сжатыми на телефоне. */
const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/
const MAX_IMAGES = 4
/** Сумма base64: тело запроса у Vercel ограничено 4,5 МБ, а скрины ещё едут в ответе синка. */
const MAX_IMAGES_CHARS = 3_000_000

/**
 * POST /api/cockpit/commands — команда локальному dev-cockpit из Mini App.
 *
 * - `{ kind: 'message', sessionId, text, images? }` — текст в сессию. Claude получит его
 *   межсессионным сообщением с пометкой «[из dev-cockpit]». `images` — до 4 скринов
 *   data-URL'ами: cockpit сохранит их файлами и допишет пути в сообщение.
 * - `{ kind: 'start-task', issueKey, title?, where? }` — взять задачу в Claude:
 *   `where: 'background'` (по умолчанию) — фоновая сессия `claude --bg "/start-task КЛЮЧ"`
 *   в ~/Разработка; `where: 'vscode'` — вкладка Claude в VS Code на рабочей машине
 *   с подставленным `/start-task КЛЮЧ` (отправить — Enter там же).
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
    const raw = Array.isArray(body.images) ? body.images : []
    if (raw.length > MAX_IMAGES) return NextResponse.json({ error: `Не больше ${MAX_IMAGES} скринов` }, { status: 400 })
    const images: { mime: string; data: string }[] = []
    for (const item of raw) {
      const m = typeof item === 'string' ? IMAGE_RE.exec(item) : null
      if (!m) return NextResponse.json({ error: 'Скрин не похож на картинку' }, { status: 400 })
      images.push({ mime: m[1], data: m[2] })
    }
    if (images.reduce((n, i) => n + i.data.length, 0) > MAX_IMAGES_CHARS) {
      return NextResponse.json({ error: 'Скрины слишком тяжёлые — отправь меньше за раз' }, { status: 413 })
    }
    if (typeof body.sessionId !== 'string' || (!text && !images.length)) {
      return NextResponse.json({ error: 'Нужны сессия и текст или скрин' }, { status: 400 })
    }
    values = {
      userId: user.id,
      kind: 'message',
      sessionId: body.sessionId,
      payload: { text: text.slice(0, MAX_TEXT), ...(images.length ? { images, imageCount: images.length } : {}) },
    }
  } else if (body.kind === 'start-task') {
    const issueKey = typeof body.issueKey === 'string' ? body.issueKey.trim().toUpperCase() : ''
    if (!TASK_KEY_RE.test(issueKey)) return NextResponse.json({ error: 'Неверный ключ задачи' }, { status: 400 })
    const title = typeof body.title === 'string' ? body.title.slice(0, 200) : ''
    const where = body.where === 'vscode' ? 'vscode' : 'background'
    values = { userId: user.id, kind: 'start-task', payload: { issueKey, title, where } }
  } else {
    return NextResponse.json({ error: 'Неизвестная команда' }, { status: 400 })
  }

  const [cmd] = await db.insert(cockpitCommands).values(values).returning({ id: cockpitCommands.id })
  return NextResponse.json({ ok: true, id: cmd.id })
}
