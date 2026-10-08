import { rrulestr } from 'rrule'

/**
 * Разбор ICS (RFC 5545) в объёме, который нужен планеру: встречи из
 * Яндекс.Календаря и ответ на приглашение.
 *
 * Своего парсера тут ровно столько, сколько требуют шесть свойств VEVENT.
 * Готовая библиотека обошлась бы дороже: в ответе на приглашение надо
 * вернуть серверу исходный текст события с одной изменённой строкой, а не
 * пересобранный из модели, иначе теряются поля, которых модель не знает.
 */

/** Участник встречи. */
export interface IcsAttendee {
  email: string
  name?: string
  /** NEEDS-ACTION | ACCEPTED | DECLINED | TENTATIVE */
  partstat: string
}

export interface IcsEvent {
  uid: string
  summary: string
  description?: string
  location?: string
  organizer?: { email: string; name?: string }
  attendees: IcsAttendee[]
  start: Date
  end: Date
  /** Событие на весь день: DTSTART был датой без времени. */
  allDay: boolean
  /** CONFIRMED | TENTATIVE | CANCELLED (по умолчанию CONFIRMED). */
  status: string
  sequence: number
  /** Строка RRULE без префикса, если встреча повторяется. */
  rrule?: string
  /** Исключённые даты повторения. */
  exdates: Date[]
  /** Экземпляр-переопределение повторяющейся встречи. */
  recurrenceId?: Date
  /** Исходный текст компонента VEVENT — им отвечаем серверу. */
  raw: string
}

/**
 * Разворачивает «свёрнутые» строки: по RFC продолжение начинается с пробела
 * или табуляции. Яндекс сворачивает длинные описания охотно, и без этого
 * шага у встречи обрезается половина темы.
 */
function unfold(ics: string): string[] {
  const out: string[] = []
  for (const line of ics.replace(/\r\n/g, '\n').split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

interface IcsProp {
  name: string
  params: Record<string, string>
  value: string
}

/** Разбирает строку `NAME;PARAM=VALUE:значение`. */
function parseLine(line: string): IcsProp | null {
  // Двоеточие внутри кавычек параметра не разделитель: ищем первое свободное.
  let inQuotes = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ':' && !inQuotes) {
      colon = i
      break
    }
  }
  if (colon === -1) return null

  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const [name, ...paramParts] = head.split(';')
  const params: Record<string, string> = {}
  for (const part of paramParts) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: name.toUpperCase(), params, value }
}

/** Экранирование RFC 5545 в тексте: \n, \, запятая, точка с запятой. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/**
 * Смещение зоны в миллисекундах на конкретный момент.
 *
 * Считается через Intl: в проекте нет библиотеки зон, а таблица правил в
 * самом ICS (VTIMEZONE) разбирается сложнее, чем стоит. Яндекс пишет в TZID
 * обычные имена IANA вроде `Europe/Moscow`, их Intl понимает.
 */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  )
  return asUtc - at.getTime()
}

/** Настенное время в зоне → момент UTC. */
export function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  // Две итерации: первая оценка берёт смещение не того момента, и на границе
  // перевода часов промахивается на час.
  let ts = guess - tzOffsetMs(new Date(guess), timeZone)
  ts = guess - tzOffsetMs(new Date(ts), timeZone)
  return new Date(ts)
}

/** Разбирает DATE-TIME в трёх формах: с Z, с TZID и дата без времени. */
function parseIcsDate(prop: IcsProp): { date: Date; allDay: boolean } {
  const value = prop.value.trim()
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    return { date: new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))), allDay: true }
  }

  const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value)
  if (!full) return { date: new Date(NaN), allDay: false }
  const [, y, mo, d, h, mi, s, zulu] = full
  const nums = [Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s)] as const

  if (zulu) {
    return {
      date: new Date(Date.UTC(nums[0], nums[1] - 1, nums[2], nums[3], nums[4], nums[5])),
      allDay: false,
    }
  }

  const tzid = prop.params.TZID
  if (tzid) {
    try {
      return { date: zonedToUtc(...nums, tzid), allDay: false }
    } catch {
      // Неизвестная зона — трактуем как UTC: лучше встреча со сдвигом, чем
      // пропавшая встреча.
    }
  }
  return {
    date: new Date(Date.UTC(nums[0], nums[1] - 1, nums[2], nums[3], nums[4], nums[5])),
    allDay: false,
  }
}

/** `mailto:ivan@example.com` → `ivan@example.com`. */
function mailto(value: string): string {
  return value.replace(/^mailto:/i, '').trim().toLowerCase()
}

/** Все VEVENT календарного объекта. */
export function parseEvents(ics: string): IcsEvent[] {
  const lines = unfold(ics)
  const events: IcsEvent[] = []

  let current: string[] | null = null
  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) {
      current = [line]
      continue
    }
    if (!current) continue
    current.push(line)
    if (line.startsWith('END:VEVENT')) {
      const event = buildEvent(current)
      if (event) events.push(event)
      current = null
    }
  }
  return events
}

function buildEvent(block: string[]): IcsEvent | null {
  const raw = block.join('\r\n')
  let uid = ''
  let summary = '(без темы)'
  let description: string | undefined
  let location: string | undefined
  let organizer: IcsEvent['organizer']
  const attendees: IcsAttendee[] = []
  let start: Date | null = null
  let end: Date | null = null
  let allDay = false
  let status = 'CONFIRMED'
  let sequence = 0
  let rrule: string | undefined
  const exdates: Date[] = []
  let recurrenceId: Date | undefined
  let durationValue: string | undefined

  for (const line of block) {
    const prop = parseLine(line)
    if (!prop) continue
    switch (prop.name) {
      case 'UID':
        uid = prop.value.trim()
        break
      case 'SUMMARY':
        summary = unescapeText(prop.value).trim() || summary
        break
      case 'DESCRIPTION':
        description = unescapeText(prop.value).trim() || undefined
        break
      case 'LOCATION':
        location = unescapeText(prop.value).trim() || undefined
        break
      case 'ORGANIZER':
        organizer = { email: mailto(prop.value), name: prop.params.CN }
        break
      case 'ATTENDEE':
        attendees.push({
          email: mailto(prop.value),
          name: prop.params.CN,
          partstat: (prop.params.PARTSTAT ?? 'NEEDS-ACTION').toUpperCase(),
        })
        break
      case 'DTSTART': {
        const parsed = parseIcsDate(prop)
        start = parsed.date
        allDay = parsed.allDay
        break
      }
      case 'DTEND':
        end = parseIcsDate(prop).date
        break
      case 'DURATION':
        durationValue = prop.value.trim()
        break
      case 'STATUS':
        status = prop.value.trim().toUpperCase()
        break
      case 'SEQUENCE':
        sequence = Number(prop.value.trim()) || 0
        break
      case 'RRULE':
        rrule = prop.value.trim()
        break
      case 'EXDATE':
        exdates.push(parseIcsDate(prop).date)
        break
      case 'RECURRENCE-ID':
        recurrenceId = parseIcsDate(prop).date
        break
    }
  }

  if (!uid || !start || Number.isNaN(start.getTime())) return null
  if (!end || Number.isNaN(end.getTime())) {
    end = durationValue
      ? new Date(start.getTime() + durationMs(durationValue))
      : new Date(start.getTime() + (allDay ? 86_400_000 : 3_600_000))
  }

  return {
    uid,
    summary,
    description,
    location,
    organizer,
    attendees,
    start,
    end,
    allDay,
    status,
    sequence,
    rrule,
    exdates,
    recurrenceId,
    raw,
  }
}

/** ISO 8601 длительность (`PT1H30M`, `P1D`) → миллисекунды. */
export function durationMs(value: string): number {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value)
  if (!m) return 3_600_000
  const n = (i: number) => Number(m[i] ?? 0) || 0
  return (n(1) * 7 * 86400 + n(2) * 86400 + n(3) * 3600 + n(4) * 60 + n(5)) * 1000
}

/** Один экземпляр встречи: для разовой — она сама, для повторяющейся — дата серии. */
export interface IcsOccurrence {
  start: Date
  end: Date
}

/**
 * Экземпляры встречи, попадающие в окно.
 *
 * Повторения разворачиваются на нашей стороне через `rrule`: Яндекс отдаёт
 * серию одним VEVENT с RRULE, а серверное разворачивание (`CALDAV:expand`)
 * поддерживается не всеми установками.
 */
export function expandOccurrences(event: IcsEvent, from: Date, to: Date): IcsOccurrence[] {
  const length = event.end.getTime() - event.start.getTime()

  if (!event.rrule) {
    return event.start < to && event.end > from ? [{ start: event.start, end: event.end }] : []
  }

  try {
    const rule = rrulestr(`RRULE:${event.rrule}`, { dtstart: event.start })
    const excluded = new Set(event.exdates.map((d) => d.getTime()))
    return rule
      .between(new Date(from.getTime() - length), to, true)
      .filter((d) => !excluded.has(d.getTime()))
      .map((d) => ({ start: d, end: new Date(d.getTime() + length) }))
      .filter((o) => o.end > from && o.start < to)
  } catch {
    // Кривой RRULE не должен прятать саму встречу — показываем хотя бы первую.
    return event.start < to && event.end > from ? [{ start: event.start, end: event.end }] : []
  }
}

/**
 * Проставляет PARTSTAT в строке ATTENDEE с нашим адресом и возвращает
 * изменённый ICS целиком.
 *
 * Правка идёт по исходному тексту, а не по разобранной модели: серверу
 * возвращается то же событие со всеми полями, которых мы не разбирали, —
 * иначе ответ на приглашение стирал бы чужие данные.
 */
export function setPartstat(ics: string, email: string, partstat: string): string | null {
  const target = email.toLowerCase()
  // Работаем по развёрнутому представлению: сворачивать обратно не обязательно,
  // длинные строки сервер принимает.
  const unfolded = unfold(ics)
  let changed = false
  const patched = unfolded.map((line) => {
    if (!line.toUpperCase().startsWith('ATTENDEE')) return line
    const prop = parseLine(line)
    if (!prop || mailto(prop.value) !== target) return line
    changed = true
    const head = line.slice(0, line.length - prop.value.length - 1)
    const withoutPartstat = head.replace(/;PARTSTAT=(?:"[^"]*"|[^;:]*)/i, '')
    return `${withoutPartstat};PARTSTAT=${partstat}:${prop.value}`
  })

  if (!changed) return null
  return `${patched.join('\r\n')}\r\n`
}
