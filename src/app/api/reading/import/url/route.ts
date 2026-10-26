import { NextRequest, NextResponse } from 'next/server'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { ImportError } from '@/lib/reading/import/files'
import { describeImport, saveImported } from '@/lib/reading/import/save'
import { fetchArticle } from '@/lib/reading/import/url'

export const maxDuration = 30

/** POST /api/reading/import/url — статья по ссылке; `source: 'habr'` — из ленты Хабра. */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { url?: unknown; source?: unknown }
  if (typeof body.url !== 'string' || !body.url.trim()) {
    return NextResponse.json({ error: 'Нужна ссылка' }, { status: 400 })
  }

  try {
    const article = await fetchArticle(body.url)
    const saved = await saveImported(user.id, {
      title: article.title,
      body: article.body,
      source: body.source === 'habr' ? 'habr' : 'url',
      sourceKey: article.url,
    })
    return NextResponse.json({ ...saved, message: describeImport(saved) }, { status: 201 })
  } catch (error) {
    if (error instanceof ImportError) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    console.error('Ошибка импорта по ссылке:', error)
    return NextResponse.json({ error: 'Не удалось загрузить страницу' }, { status: 502 })
  }
}
