import { XMLParser } from 'fast-xml-parser'
import type { HabrFeed } from '../types'
import { canonicalUrl } from './url'

/**
 * Свежие статьи Хабра по выбранным темам: RSS хаба
 * (`/ru/rss/hubs/<hub>/articles/`) или поиска (`/ru/rss/search/?q=`).
 */

export interface HabrItem {
  title: string
  url: string
  publishedAt: string
  summary: string
  feed: string
}

export function feedUrl(feed: HabrFeed): string {
  if (feed.kind === 'hub') {
    return `https://habr.com/ru/rss/hubs/${encodeURIComponent(feed.id)}/articles/?fl=ru`
  }
  const q = encodeURIComponent(feed.q)
  return `https://habr.com/ru/rss/search/?q=${q}&target_type=posts&order=date&fl=ru`
}

export function feedLabel(feed: HabrFeed): string {
  return feed.kind === 'hub' ? `хаб ${feed.id}` : `«${feed.q}»`
}

const parser = new XMLParser({ ignoreAttributes: true, cdataPropName: false, trimValues: true })

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseHabrRss(xml: string, label: string): HabrItem[] {
  const data = parser.parse(xml) as { rss?: { channel?: { item?: unknown } } }
  const raw = data.rss?.channel?.item
  const items = Array.isArray(raw) ? raw : raw ? [raw] : []
  const out: HabrItem[] = []
  for (const item of items as Record<string, unknown>[]) {
    const link = typeof item.link === 'string' ? item.link : ''
    const title = typeof item.title === 'string' ? item.title : ''
    if (!link || !title) continue
    let url: string
    try {
      url = canonicalUrl(new URL(link))
    } catch {
      continue
    }
    const date = new Date(String(item.pubDate ?? ''))
    out.push({
      title: stripHtml(title),
      url,
      publishedAt: Number.isNaN(date.getTime()) ? '' : date.toISOString(),
      summary: stripHtml(String(item.description ?? '')).slice(0, 220),
      feed: label,
    })
  }
  return out
}

/** Все ленты разом; упавшая лента не роняет остальные. Ответ Хабра кэшируется на 15 минут. */
export async function fetchHabr(feeds: HabrFeed[]): Promise<HabrItem[]> {
  const results = await Promise.allSettled(
    feeds.map(async (feed) => {
      const res = await fetch(feedUrl(feed), {
        headers: { 'User-Agent': 'Mozilla/5.0 (tg-planer reading)' },
        signal: AbortSignal.timeout(10_000),
        next: { revalidate: 900 },
      })
      if (!res.ok) throw new Error(`RSS ${res.status}`)
      return parseHabrRss(await res.text(), feedLabel(feed))
    }),
  )
  const seen = new Set<string>()
  const items: HabrItem[] = []
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const item of result.value) {
      if (seen.has(item.url)) continue
      seen.add(item.url)
      items.push(item)
    }
  }
  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 60)
}
