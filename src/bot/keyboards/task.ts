import { InlineKeyboard } from 'grammy'

/** Кнопки подтверждения после AI-парсинга (одна задача) */
export function confirmKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Верно', `confirm:${pendingId}`)
    .text('✏️ Изменить', `edit:${pendingId}`)
    .row()
    .text('❌ Отмена', `cancel:${pendingId}`)
}

/** Кнопки подтверждения для нескольких задач */
export function confirmMultiKeyboard(pendingIds: string[]): InlineKeyboard {
  const joined = pendingIds.join(',')
  return new InlineKeyboard()
    .text('✅ Всё верно', `confirm_all:${joined}`)
    .row()
    .text('❌ Отменить всё', `cancel_all:${joined}`)
}

/** Кнопки действий на задаче */
export function taskActionsKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Готово', `done:${taskId}`)
    .text('🗑 Удалить', `delete:${taskId}`)
}

/** Кнопки на напоминании */
export function reminderKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Готово', `done:${taskId}`)
    .text('⏰ +1ч', `snooze:${taskId}:1h`)
    .text('📅 Завтра', `snooze:${taskId}:1d`)
}

/** Кнопки для просроченной задачи */
export function overdueKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('📅 Сегодня', `reschedule:${taskId}:today`)
    .text('📅 Завтра', `reschedule:${taskId}:tomorrow`)
    .row()
    .text('✅ Выполнено', `done:${taskId}`)
    .text('🗑 Удалить', `delete:${taskId}`)
}

/** Кнопка открытия Mini App */
export function miniAppKeyboard(): InlineKeyboard {
  const url = process.env.WEBAPP_URL
  if (!url) return new InlineKeyboard().text('⚠️ WEBAPP_URL не настроен')
  return new InlineKeyboard().webApp('📱 Открыть планировщик', url)
}

/** Кнопки «Мой день» */
export function myDayKeyboard(taskId: string, isInMyDay: boolean): InlineKeyboard {
  if (isInMyDay) {
    return new InlineKeyboard()
      .text('✅ Готово', `done:${taskId}`)
      .text('🚫 Убрать из дня', `myday_remove:${taskId}`)
  }
  return new InlineKeyboard()
    .text('✅ Готово', `done:${taskId}`)
    .text('☀️ В мой день', `myday_add:${taskId}`)
}
