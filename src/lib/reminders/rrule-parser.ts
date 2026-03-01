import { RRule, Frequency } from 'rrule'

/**
 * Преобразует описание повторения на русском в rrule строку.
 * Используется после AI-парсинга, когда LLM возвращает recurrence.
 */
export function parseRecurrenceToRRule(recurrence: string, startDate?: Date): string | null {
  const text = recurrence.toLowerCase().trim()
  const start = startDate ?? new Date()

  let freq: Frequency | null = null
  let interval = 1
  let byweekday: number[] | undefined

  // Каждый день / ежедневно
  if (text.includes('каждый день') || text.includes('ежедневно')) {
    freq = RRule.DAILY
  }
  // Каждую неделю / еженедельно
  else if (text.includes('каждую неделю') || text.includes('еженедельно') || text.includes('раз в неделю')) {
    freq = RRule.WEEKLY
  }
  // Каждый месяц / ежемесячно
  else if (text.includes('каждый месяц') || text.includes('ежемесячно') || text.includes('раз в месяц')) {
    freq = RRule.MONTHLY
  }
  // Дни недели
  else if (text.includes('каждый понедельник') || text.includes('по понедельникам')) {
    freq = RRule.WEEKLY
    byweekday = [RRule.MO.weekday]
  } else if (text.includes('каждый вторник') || text.includes('по вторникам')) {
    freq = RRule.WEEKLY
    byweekday = [RRule.TU.weekday]
  } else if (text.includes('каждую среду') || text.includes('по средам')) {
    freq = RRule.WEEKLY
    byweekday = [RRule.WE.weekday]
  } else if (text.includes('каждый четверг') || text.includes('по четвергам')) {
    freq = RRule.WEEKLY
    byweekday = [RRule.TH.weekday]
  } else if (text.includes('каждую пятницу') || text.includes('по пятницам')) {
    freq = RRule.WEEKLY
    byweekday = [RRule.FR.weekday]
  } else if (text.includes('каждую субботу') || text.includes('по субботам')) {
    freq = RRule.WEEKLY
    byweekday = [RRule.SA.weekday]
  } else if (text.includes('каждое воскресенье') || text.includes('по воскресеньям')) {
    freq = RRule.WEEKLY
    byweekday = [RRule.SU.weekday]
  }
  // Будни
  else if (text.includes('каждый будний день') || text.includes('по будням')) {
    freq = RRule.WEEKLY
    byweekday = [RRule.MO.weekday, RRule.TU.weekday, RRule.WE.weekday, RRule.TH.weekday, RRule.FR.weekday]
  }
  // Через N дней
  else {
    const matchDays = text.match(/через (\d+) дн/)
    if (matchDays) {
      freq = RRule.DAILY
      interval = parseInt(matchDays[1])
    }
    const matchWeeks = text.match(/через (\d+) недел/)
    if (matchWeeks) {
      freq = RRule.WEEKLY
      interval = parseInt(matchWeeks[1])
    }
  }

  if (freq === null) return null

  const rule = new RRule({
    freq,
    interval,
    byweekday,
    dtstart: start,
  })

  return rule.toString()
}

/**
 * Получает следующую дату напоминания по rrule.
 */
export function getNextOccurrence(rruleStr: string, after?: Date): Date | null {
  const rule = RRule.fromString(rruleStr)
  const afterDate = after ?? new Date()
  const next = rule.after(afterDate)
  return next
}
