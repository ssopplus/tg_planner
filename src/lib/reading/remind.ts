import type { ReadingSettings } from './types'

/**
 * Когда бот напоминает о тренировке. Крон дайджестов ходит раз в 15 минут,
 * поэтому решение не «ровно в 19:00», а «уже 19:00 или позже, сегодня ещё не
 * напоминали и не занимались». Что уже отправлено, лежит в
 * `users.settings.readingReminder` — отдельным ключом, чтобы сохранение
 * настроек из Mini App (ключ `reading` целиком) его не затирало.
 */

export type ReminderKind = 'daily' | 'streak'

export interface ReminderState {
  /** День последней отправки, YYYY-MM-DD по времени пользователя. */
  day: string
  daily: boolean
  streak: boolean
}

/** Второе напоминание — «серия сгорит». */
export const STREAK_GUARD_TIME = '21:30'
/** Позже не пишем: если крон лежал весь вечер, ночное «пора заниматься» только раздражает. */
export const QUIET_FROM = '23:00'

export function parseReminderState(raw: unknown): ReminderState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.day !== 'string') return null
  return { day: r.day, daily: r.daily === true, streak: r.streak === true }
}

/** Местное время пользователя «HH:MM» — сравнивается как строка. */
export function localTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

export function reminderDue(input: {
  settings: Pick<ReadingSettings, 'remindEnabled' | 'remindTime' | 'streakGuard'>
  state: ReminderState | null
  today: string
  time: string
  /** Была ли хоть одна тренировка за всё время: тем, кто не начинал, не пишем. */
  started: boolean
  trainedToday: boolean
  /** Серия на вчера: сколько дней подряд занимались до сегодняшнего. */
  streak: number
}): ReminderKind | null {
  const { settings, today, time } = input
  if (!input.started || input.trainedToday || time >= QUIET_FROM) return null
  const sent = input.state?.day === today ? input.state : null

  if (settings.remindEnabled && !sent?.daily && time >= settings.remindTime) {
    // Ежедневное позже 21:30 и есть «напоминание о серии» — хватит одного.
    if (!(settings.streakGuard && sent?.streak)) return 'daily'
  }
  if (settings.streakGuard && !sent?.streak && input.streak > 0 && time >= STREAK_GUARD_TIME) {
    // Ежедневное только что ушло (или стоит на то же время) — второе вдогонку не шлём.
    const dailyLate = settings.remindEnabled && settings.remindTime >= STREAK_GUARD_TIME
    if (!dailyLate) return 'streak'
  }
  return null
}

export function nextReminderState(
  state: ReminderState | null,
  today: string,
  kind: ReminderKind,
): ReminderState {
  const base = state?.day === today ? state : { day: today, daily: false, streak: false }
  return { ...base, [kind]: true }
}
