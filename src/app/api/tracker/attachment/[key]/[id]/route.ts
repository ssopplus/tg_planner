import { NextRequest, NextResponse } from 'next/server'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { db } from '@/lib/db'
import { tasks } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

/**
 * Прокси для attachments Yandex Tracker.
 *
 * Зачем нужно: картинки в description тикета лежат как
 * `/ajax/v2/attachments/<id>` и требуют OAuth-токен. Mini App не может
 * добавить `Authorization: OAuth` в <img src>, поэтому стримим через свой
 * эндпоинт, который добавляет токен сам.
 *
 * Защита: проверяем initData пользователя; затем убеждаемся, что задача с
 * key=<key> действительно есть у этого пользователя в БД и пришла из
 * yandex-tracker. Без этого любой авторизованный пользователь мог бы
 * скачивать вложения любых тикетов по угаданному id.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string; id: string }> },
) {
  // <img src> не умеет слать кастомные заголовки, поэтому initData
  // принимается ещё и через query-параметр ?initData=<...>. Сначала
  // пробуем header (на случай fetch'а из JS), потом fallback на query.
  const initData =
    request.headers.get('X-Telegram-Init-Data') ??
    request.nextUrl.searchParams.get('initData') ??
    ''
  const user = await authorizeMiniApp(initData)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { key, id } = await params
  if (!/^[A-Z]+-\d+$/.test(key) || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'bad key/id' }, { status: 400 })
  }

  // Проверяем, что задача доступна пользователю
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, user.id),
        eq(tasks.externalSource, 'yandex-tracker'),
        eq(tasks.externalId, key),
      ),
    )
    .limit(1)
  if (!task) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const token = process.env.YANDEX_TRACKER_TOKEN
  const orgId = process.env.YANDEX_TRACKER_ORG_ID
  if (!token || !orgId) {
    return NextResponse.json({ error: 'tracker not configured' }, { status: 500 })
  }

  // Берём метаданные attachment'а через корневой путь /v2/attachments/<id>.
  // В Yandex Tracker attachment_id уникален в рамках организации, и одна
  // картинка может «висеть» в одном тикете, а быть встроена в описание
  // другого (по копипасте URL). Если использовать /v2/issues/<key>/attachments/<id>,
  // получим 404 для таких «заимствованных» картинок. Корневой путь работает
  // всегда, а доступ мы уже проверили выше — пользователь видит задачу <key>,
  // а раз он её видит, значит и весь её description (с любыми URL картинок).
  const metaRes = await fetch(`https://api.tracker.yandex.net/v2/attachments/${id}`, {
    headers: { Authorization: `OAuth ${token}`, 'X-Org-ID': orgId },
  })
  if (!metaRes.ok) {
    return NextResponse.json(
      { error: 'attachment fetch failed', status: metaRes.status },
      { status: metaRes.status },
    )
  }
  const meta = (await metaRes.json()) as { name: string; mimetype: string; content: string }

  // У attachment'а в metadata есть готовый content-URL — используем его, чтобы
  // не угадывать формат пути и encoding имени файла.
  const fileRes = await fetch(meta.content, {
    headers: { Authorization: `OAuth ${token}`, 'X-Org-ID': orgId },
  })
  if (!fileRes.ok || !fileRes.body) {
    return NextResponse.json(
      { error: 'attachment download failed', status: fileRes.status },
      { status: fileRes.status },
    )
  }

  // Картинки в Tracker неизменны (attachment_id всегда указывает на тот же
  // байтстрим), поэтому кешируем агрессивно на стороне браузера/Vercel.
  return new NextResponse(fileRes.body, {
    headers: {
      'Content-Type': meta.mimetype,
      'Cache-Control': 'private, max-age=86400, immutable',
    },
  })
}
