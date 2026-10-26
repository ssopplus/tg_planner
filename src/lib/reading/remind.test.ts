import { describe, expect, it } from 'vitest'
import { localTime, nextReminderState, parseReminderState, reminderDue } from './remind'

const settings = { remindEnabled: true, remindTime: '19:00', streakGuard: true }
const base = {
  settings,
  state: null,
  today: '2026-10-26',
  time: '19:05',
  started: true,
  trainedToday: false,
  streak: 3,
}

describe('напоминания о чтении', () => {
  it('ежедневное — в выбранное время и позже, один раз за день', () => {
    expect(reminderDue({ ...base, time: '18:50' })).toBeNull()
    expect(reminderDue(base)).toBe('daily')
    expect(reminderDue({ ...base, time: '20:40' })).toBe('daily')
    const state = nextReminderState(null, base.today, 'daily')
    expect(reminderDue({ ...base, state, time: '20:00' })).toBeNull()
  })

  it('вчерашняя отметка не мешает сегодняшнему напоминанию', () => {
    const state = { day: '2026-10-25', daily: true, streak: true }
    expect(reminderDue({ ...base, state })).toBe('daily')
  })

  it('не пишет, если уже занимался, ещё не начинал или поздно', () => {
    expect(reminderDue({ ...base, trainedToday: true })).toBeNull()
    expect(reminderDue({ ...base, started: false })).toBeNull()
    expect(reminderDue({ ...base, time: '23:10' })).toBeNull()
  })

  it('«серия сгорит» — после 21:30, если серия есть', () => {
    const state = nextReminderState(null, base.today, 'daily')
    expect(reminderDue({ ...base, state, time: '21:31' })).toBe('streak')
    expect(reminderDue({ ...base, state, time: '21:31', streak: 0 })).toBeNull()
    const both = nextReminderState(state, base.today, 'streak')
    expect(both).toEqual({ day: base.today, daily: true, streak: true })
    expect(reminderDue({ ...base, state: both, time: '22:00' })).toBeNull()
  })

  it('поздний ежедневный не дублируется напоминанием о серии', () => {
    const late = { ...settings, remindTime: '22:00' }
    expect(reminderDue({ ...base, settings: late, time: '21:45' })).toBeNull()
    expect(reminderDue({ ...base, settings: late, time: '22:05' })).toBe('daily')
  })

  it('только «серия», если ежедневные выключены', () => {
    const off = { ...settings, remindEnabled: false }
    expect(reminderDue({ ...base, settings: off })).toBeNull()
    expect(reminderDue({ ...base, settings: off, time: '21:40' })).toBe('streak')
  })

  it('разбирает сохранённое состояние и местное время', () => {
    expect(parseReminderState(null)).toBeNull()
    expect(parseReminderState({ day: '2026-10-26', daily: true })).toEqual({
      day: '2026-10-26',
      daily: true,
      streak: false,
    })
    expect(localTime(new Date('2026-10-26T16:05:00Z'), 'Europe/Moscow')).toBe('19:05')
    expect(localTime(new Date('2026-10-26T21:30:00Z'), 'Europe/Moscow')).toBe('00:30')
  })
})
