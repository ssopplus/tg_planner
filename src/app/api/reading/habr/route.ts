import { NextRequest, NextResponse } from 'next/server'
import { and, eq, like } from 'drizzle-orm'
import { db } from '@/lib/db'
import { readingTexts } from '@/lib/db/schema'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { fetchHabr } from '@/lib/reading/import/habr'
import { parseReadingSettings } from '@/lib/reading/settings'

/**
 * GET /api/reading/habr — свежие статьи по темам из настроек. У уже
 * добавленных стоит `added`, чтобы лента не предлагала их второй раз.
 */
export async function GET(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const settings = parseReadingSettings((user.settings as Record<string, unknown>)?.reading)
  const [items, added] = await Promise.all([
    fetchHabr(settings.habrFeeds),
    db
      .selectDistinct({ url: readingTexts.sourceUrl })
      .from(readingTexts)
      .where(
        and(eq(readingTexts.userId, user.id), like(readingTexts.sourceUrl, 'https://habr.com/%')),
      ),
  ])
  const addedSet = new Set(added.map((r) => r.url))
  return NextResponse.json(items.map((item) => ({ ...item, added: addedSet.has(item.url) })))
}
