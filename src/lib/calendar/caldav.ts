/**
 * Минимальный CalDAV-клиент для Яндекс.Календаря.
 *
 * REST API у Яндекс.Календаря нет — только CalDAV на caldav.yandex.ru, и
 * пускает он по **паролю приложения** (id.yandex.ru → Безопасность → Пароли
 * приложений → Календарь). Обычный пароль и OAuth-токен Трекера не подходят.
 *
 * Запросов ровно четыре: найти принципала, найти его календари, выбрать
 * события в окне дат, вернуть изменённое событие. Поэтому и клиент свой, и
 * XML разбирается регулярками: ответы CalDAV — плоский multistatus, полного
 * разбора XML тут не требуется.
 */

const DEFAULT_BASE = 'https://caldav.yandex.ru'

export interface CalDavConfig {
  baseUrl: string
  login: string
  password: string
  /** Адрес, по которому мы ищем себя среди участников встречи. */
  email: string
}

/** Конфиг из окружения; null — календарь не настроен, и это не ошибка. */
export function caldavConfig(): CalDavConfig | null {
  const login = process.env.YANDEX_CALDAV_LOGIN
  const password = process.env.YANDEX_CALDAV_PASSWORD
  if (!login || !password) return null
  return {
    baseUrl: (process.env.YANDEX_CALDAV_URL ?? DEFAULT_BASE).replace(/\/$/, ''),
    login,
    password,
    email: (process.env.YANDEX_CALDAV_EMAIL ?? login).toLowerCase(),
  }
}

function authHeader(config: CalDavConfig): string {
  return `Basic ${Buffer.from(`${config.login}:${config.password}`).toString('base64')}`
}

/** Абсолютный URL из href, который сервер отдаёт относительным путём. */
function absolute(config: CalDavConfig, href: string): string {
  return href.startsWith('http') ? href : `${config.baseUrl}${href}`
}

interface DavResponse {
  status: number
  body: string
  headers: Headers
}

async function dav(
  config: CalDavConfig,
  method: string,
  url: string,
  options: { body?: string; depth?: string; headers?: Record<string, string> } = {},
): Promise<DavResponse> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(config),
      'Content-Type': 'application/xml; charset=utf-8',
      ...(options.depth ? { Depth: options.depth } : {}),
      ...options.headers,
    },
    body: options.body,
  })
  return { status: res.status, body: await res.text(), headers: res.headers }
}

/** Тег без учёта префикса пространства имён: `d:href`, `D:href`, `href`. */
function tagContents(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?${tag}>`, 'gi')
  return [...xml.matchAll(re)].map((m) => m[1])
}

/** Самозакрывающийся или парный тег присутствует в куске XML. */
function hasTag(xml: string, tag: string): boolean {
  return new RegExp(`<(?:[A-Za-z0-9_-]+:)?${tag}[\\s/>]`, 'i').test(xml)
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
}

/** Один `<response>` multistatus-ответа. */
function responses(xml: string): string[] {
  return tagContents(xml, 'response')
}

export interface CalDavCalendar {
  href: string
  displayName: string
}

/**
 * Находит календари пользователя.
 *
 * Два шага вместо одного: сначала у принципала спрашивается
 * `calendar-home-set` (где лежат календари), потом сама коллекция листается.
 * Прямой путь `/calendars/<логин>/` у Яндекса работает, но documented-способ
 * переживёт переезд адресов.
 */
export async function discoverCalendars(config: CalDavConfig): Promise<CalDavCalendar[]> {
  const principal = `${config.baseUrl}/principals/users/${encodeURIComponent(config.login)}/`
  const homeRes = await dav(config, 'PROPFIND', principal, {
    depth: '0',
    body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set/></d:prop>
</d:propfind>`,
  })

  if (homeRes.status === 401) {
    throw new Error(
      'CalDAV: 401 — пароль приложения не подошёл. Проверь, что он создан на id.yandex.ru для «Календаря», и что администратор организации не запретил сервисные приложения.',
    )
  }
  if (homeRes.status !== 207) {
    throw new Error(`CalDAV: ответ ${homeRes.status} на поиск календарей — ${homeRes.body.slice(0, 200)}`)
  }

  const homeHrefs = tagContents(homeRes.body, 'calendar-home-set').flatMap((x) =>
    tagContents(x, 'href'),
  )
  const home = homeHrefs[0]?.trim()
  if (!home) throw new Error('CalDAV: сервер не вернул calendar-home-set')

  const listRes = await dav(config, 'PROPFIND', absolute(config, decodeXml(home)), {
    depth: '1',
    body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:resourcetype/><d:displayname/></d:prop>
</d:propfind>`,
  })
  if (listRes.status !== 207) {
    throw new Error(`CalDAV: ответ ${listRes.status} на список календарей`)
  }

  const calendars: CalDavCalendar[] = []
  for (const block of responses(listRes.body)) {
    if (!hasTag(block, 'calendar')) continue
    const href = tagContents(block, 'href')[0]?.trim()
    if (!href) continue
    const name = tagContents(block, 'displayname')[0]?.trim()
    calendars.push({ href: decodeXml(href), displayName: decodeXml(name ?? 'Календарь') })
  }
  return calendars
}

/** Событие, как его отдал сервер: текст ICS плюс адрес и версия. */
export interface CalDavObject {
  href: string
  etag: string | null
  ics: string
}

function icsStamp(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`
}

/** События календаря, пересекающие окно дат. */
export async function fetchEvents(
  config: CalDavConfig,
  calendarHref: string,
  from: Date,
  to: Date,
): Promise<CalDavObject[]> {
  const res = await dav(config, 'REPORT', absolute(config, calendarHref), {
    depth: '1',
    body: `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${icsStamp(from)}" end="${icsStamp(to)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`,
  })
  if (res.status !== 207) {
    throw new Error(`CalDAV: ответ ${res.status} на выборку событий — ${res.body.slice(0, 200)}`)
  }

  const objects: CalDavObject[] = []
  for (const block of responses(res.body)) {
    const href = tagContents(block, 'href')[0]?.trim()
    const data = tagContents(block, 'calendar-data')[0]
    if (!href || !data) continue
    objects.push({
      href: decodeXml(href),
      etag: tagContents(block, 'getetag')[0]?.trim().replace(/^"|"$/g, '') ?? null,
      ics: decodeXml(data).trim(),
    })
  }
  return objects
}

/**
 * Читает один объект по его адресу.
 *
 * Ответ на приглашение всегда начинается отсюда, а не с того, что лежит в
 * зеркале: между выборкой и нажатием кнопки встречу могли изменить, и
 * отвечать надо на актуальную версию.
 */
export async function getObject(
  config: CalDavConfig,
  href: string,
): Promise<{ ics: string; etag: string | null } | null> {
  const res = await dav(config, 'GET', absolute(config, href), {
    headers: { 'Content-Type': 'text/calendar' },
  })
  if (res.status === 404) return null
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`CalDAV: ответ ${res.status} на чтение события`)
  }
  return { ics: res.body, etag: res.headers.get('etag')?.replace(/^"|"$/g, '') ?? null }
}

/**
 * Возвращает изменённое событие на сервер.
 *
 * `If-Match` по ETag обязателен: без него ответ на приглашение затёр бы
 * правку, сделанную в Календаре между нашей выборкой и нажатием кнопки.
 * 412 означает именно это — событие уже изменилось, надо перечитать.
 */
export async function putEvent(
  config: CalDavConfig,
  href: string,
  etag: string | null,
  ics: string,
): Promise<{ ok: boolean; status: number; reason?: string }> {
  const res = await dav(config, 'PUT', absolute(config, href), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      ...(etag ? { 'If-Match': `"${etag}"` } : {}),
    },
    body: ics,
  })
  if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status }
  if (res.status === 412) {
    return { ok: false, status: 412, reason: 'встречу изменили на стороне Календаря' }
  }
  return { ok: false, status: res.status, reason: res.body.slice(0, 200) }
}

/**
 * Что сервер объявляет в заголовке DAV.
 *
 * Важен `calendar-auto-schedule`: именно он отвечает за то, уйдёт ли ответ
 * организатору, когда мы меняем свой PARTSTAT. Без него кнопка «Буду»
 * изменит статус только в моём календаре.
 */
export async function serverFeatures(config: CalDavConfig): Promise<string[]> {
  const res = await dav(config, 'OPTIONS', `${config.baseUrl}/`)
  return (res.headers.get('dav') ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}
