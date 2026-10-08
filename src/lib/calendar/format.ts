/**
 * Человеческое представление встречи в таймзоне пользователя.
 *
 * Отдельно от разбора ICS: там время живёт в UTC, а читает его человек,
 * сидящий в своей зоне, и смешивать эти два мира в одном модуле неудобно.
 */

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const MONTHS = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
]

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

/** Разбирает момент на календарные части в заданной зоне. */
export function zonedParts(at: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0'
  const weekdayName = get('weekday')
  const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayName)
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: index === -1 ? 0 : index,
  }
}

/** `YYYY-MM-DD` в заданной зоне — ключ дня для сравнения «это сегодня?». */
export function dayKey(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

function time(p: ZonedParts): string {
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/** «чт, 9 окт, 11:00–11:30» или «9 окт, весь день». */
export function formatSlot(
  start: Date,
  end: Date,
  allDay: boolean,
  timeZone: string,
): string {
  const s = zonedParts(start, timeZone)
  const date = `${WEEKDAYS[s.weekday]}, ${s.day} ${MONTHS[s.month - 1]}`
  if (allDay) return `${date}, весь день`

  const e = zonedParts(end, timeZone)
  const sameDay = s.year === e.year && s.month === e.month && s.day === e.day
  return sameDay
    ? `${date}, ${time(s)}–${time(e)}`
    : `${date}, ${time(s)} → ${e.day} ${MONTHS[e.month - 1]}, ${time(e)}`
}

/** Только время начала — для списка встреч дня. */
export function formatStartTime(start: Date, allDay: boolean, timeZone: string): string {
  return allDay ? 'весь день' : time(zonedParts(start, timeZone))
}

/** Начало текущих суток пользователя как момент UTC. */
export function startOfToday(timeZone: string, now = new Date()): Date {
  const p = zonedParts(now, timeZone)
  // Отматываем от текущего момента часы и минуты, уже посчитанные в нужной
  // зоне: так не нужен обратный перевод «настенное время → UTC».
  const ms = now.getTime()
  const sinceMidnight = (p.hour * 60 + p.minute) * 60_000 + (now.getSeconds() * 1000 + now.getMilliseconds())
  return new Date(ms - sinceMidnight)
}

/** Мой ответ на приглашение словами. */
export function partstatLabel(partstat: string): string {
  switch (partstat) {
    case 'ACCEPTED':
      return 'буду'
    case 'DECLINED':
      return 'не буду'
    case 'TENTATIVE':
      return 'может быть'
    default:
      return 'без ответа'
  }
}
