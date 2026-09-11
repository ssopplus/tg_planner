import { NextRequest, NextResponse } from 'next/server'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { listQueues } from '@/lib/tracker/client'

/**
 * GET /api/tracker/queues — очереди Яндекс.Трекера для экрана настроек.
 *
 * Токен Трекера живёт только на сервере, поэтому список очередей клиент
 * получает через этот роут, а не напрямую из API Трекера.
 */
export async function GET(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = process.env.YANDEX_TRACKER_TOKEN
  const orgId = process.env.YANDEX_TRACKER_ORG_ID
  if (!token || !orgId) {
    return NextResponse.json({ error: 'Трекер не настроен' }, { status: 503 })
  }

  try {
    return NextResponse.json(await listQueues({ token, orgId }))
  } catch (error) {
    // Протухший токен — самая частая причина; отдаём текст, чтобы он был
    // виден в настройках, а не превращался в молчаливо пустой список.
    const message = error instanceof Error ? error.message : 'неизвестная ошибка'
    return NextResponse.json({ error: `Трекер недоступен: ${message}` }, { status: 502 })
  }
}
