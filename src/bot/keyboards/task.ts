import { InlineKeyboard } from 'grammy'

/** Кнопки подтверждения после AI-парсинга */
export function confirmKeyboard(pendingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Верно', `confirm:${pendingId}`)
    .text('✏️ Изменить', `edit:${pendingId}`)
    .row()
    .text('❌ Отмена', `cancel:${pendingId}`)
}

/** Кнопки действий на задаче */
export function taskActionsKeyboard(taskId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Готово', `done:${taskId}`)
    .text('🗑 Удалить', `delete:${taskId}`)
}
