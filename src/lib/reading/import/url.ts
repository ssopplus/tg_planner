import { decodeText, ImportError, type ExtractedText } from './files'
import { extractArticle } from './html'

/** Страница больше этого — не статья, а что-то не то. */
const MAX_PAGE_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000

/** Хабр и многие сайты отдают пустую заглушку без браузерного User-Agent. */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

/**
 * Адрес можно открывать с сервера: только http(s) и не внутренние хосты —
 * иначе форма «по ссылке» превращается в прокси во внутреннюю сеть.
 */
export function parsePublicUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new ImportError('Это не ссылка')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImportError('Нужна ссылка http или https')
  }
  const host = url.hostname.toLowerCase()
  const privateHost =
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^(127|10|0)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host.startsWith('[')
  if (privateHost) throw new ImportError('Внутренние адреса не открываем')
  return url
}

/** Ссылка без меток рекламных кампаний — по ней ищем дубли. */
export function canonicalUrl(url: URL): string {
  const copy = new URL(url.toString())
  for (const key of Array.from(copy.searchParams.keys())) {
    if (/^utm_|^fbclid$|^gclid$|^yclid$/i.test(key)) copy.searchParams.delete(key)
  }
  copy.hash = ''
  return copy.toString()
}

export async function fetchArticle(raw: string): Promise<ExtractedText & { url: string }> {
  const url = parsePublicUrl(raw)
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new ImportError(`Сайт ответил ошибкой ${response.status}`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > MAX_PAGE_BYTES) throw new ImportError('Страница слишком большая')

  const type = response.headers.get('content-type') ?? ''
  const data = new Uint8Array(await response.arrayBuffer())
  if (data.byteLength > MAX_PAGE_BYTES) throw new ImportError('Страница слишком большая')
  const charset = /charset=([^;]+)/i.exec(type)?.[1]?.trim()
  // Редирект мог увести на внутренний адрес — проверяем и конечный.
  const finalUrl = canonicalUrl(parsePublicUrl(response.url || url.toString()))

  if (type.includes('text/plain')) {
    return {
      title: url.pathname.split('/').pop() || url.hostname,
      body: decodeText(data, charset),
      url: finalUrl,
    }
  }
  if (!type.includes('html')) {
    throw new ImportError('По ссылке не страница: пришлите файл, если это книга или PDF')
  }
  const article = extractArticle(decodeText(data, charset), finalUrl)
  if (!article) throw new ImportError('Не нашёл на странице основной текст')
  return { ...article, url: finalUrl }
}
