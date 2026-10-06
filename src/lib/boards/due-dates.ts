/**
 * Колонки доски личных дел — это сроки, а не статусы.
 *
 * Здесь живёт обе стороны соответствия: по какой дате дело попадает в колонку
 * и какая дата проставляется, когда карточку перетащили в другую. Логика
 * чистая и не зависит от React: так её можно проверить отдельно от интерфейса.
 *
 * Неделя считается с понедельника по воскресенье — так её видит пользователь,
 * а не `Date.getDay()`, где неделя начинается с воскресенья.
 */

export type DueColumn = 'today' | 'week' | 'later' | 'none'

export const DUE_COLUMNS: Array<{ id: DueColumn; title: string }> = [
  { id: 'today', title: 'Сегодня' },
  { id: 'week', title: 'На неделе' },
  { id: 'later', title: 'Потом' },
  { id: 'none', title: 'Без даты' },
]

/** Дата как YYYY-MM-DD без таймзонных сюрпризов. */
export function toDayString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() + delta)
  return toDayString(date)
}

/** Сколько дней осталось до воскресенья включительно. Воскресенье — 0. */
function daysUntilSunday(day: string): number {
  const weekday = new Date(`${day}T12:00:00`).getDay()
  return weekday === 0 ? 0 : 7 - weekday
}

/**
 * Конец «этой недели» для сроков.
 *
 * В воскресенье неделя кончается сегодня, и ставить такой срок бессмысленно —
 * карточка тут же вернулась бы в «Сегодня». Поэтому воскресенье считает концом
 * недели следующее воскресенье; тогда и «Потом» остаётся строго дальше.
 */
function weekEnd(today: string): number {
  const left = daysUntilSunday(today)
  return left === 0 ? 7 : left
}

/**
 * В какую колонку попадает дело.
 *
 * Просроченное остаётся в «Сегодня», а не заводит себе отдельную колонку:
 * вчерашнее дело сегодня нужно сделать сегодня, и показывать его отдельно от
 * сегодняшних — значит прятать.
 */
export function columnForDue(dueDate: string | null, today: string): DueColumn {
  if (!dueDate) return 'none'
  if (dueDate <= today) return 'today'
  return dueDate <= addDays(today, weekEnd(today)) ? 'week' : 'later'
}

/**
 * Какую дату проставить, когда карточку перенесли в колонку.
 *
 * «На неделе» — конец текущей недели, чтобы дело не висело без срока, но и не
 * требовало внимания прямо сейчас. Если сегодня уже воскресенье, текущая
 * неделя кончается сегодня, поэтому берём следующую: иначе карточка
 * перепрыгнула бы обратно в «Сегодня».
 */
export function dueForColumn(column: DueColumn, today: string): string | null {
  switch (column) {
    case 'today':
      return today
    case 'week':
      return addDays(today, weekEnd(today))
    case 'later':
      return addDays(today, weekEnd(today) + 7)
    case 'none':
      return null
  }
}

/** Подпись срока на карточке: «сегодня», «завтра», «чт», «20 окт». */
export function formatDue(dueDate: string | null, today: string): string | null {
  if (!dueDate) return null
  if (dueDate === today) return 'сегодня'
  if (dueDate === addDays(today, 1)) return 'завтра'
  if (dueDate < today) return `просрочено · ${shortDate(dueDate)}`

  // Внутри недели достаточно дня недели — он короче и читается быстрее.
  if (dueDate <= addDays(today, weekEnd(today))) {
    return new Date(`${dueDate}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short' })
  }
  return shortDate(dueDate)
}

function shortDate(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  })
}
