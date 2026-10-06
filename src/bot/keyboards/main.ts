import { Keyboard } from 'grammy'

/**
 * Постоянная клавиатура под полем ввода.
 *
 * Кнопка меню слева остаётся `web_app` («Планировщик»): только она открывает
 * Mini App во весь экран. Поэтому быстрые действия живут здесь — это
 * независимый механизм, который кнопку меню не занимает.
 *
 * Тексты кнопок одновременно служат командами: обработчик ловит их по точному
 * совпадению, поэтому менять их нужно вместе с `BUTTON_*` ниже.
 */
export const BUTTON_NEW_TASK = '➕ Новая задача'
export const BUTTON_LOG_TIME = '⏱ Списать время'
export const BUTTON_TODAY = '📅 Что сегодня'
export const BUTTON_COORDINATION = '🤝 Координация'

export const MAIN_BUTTONS = [
  BUTTON_NEW_TASK,
  BUTTON_LOG_TIME,
  BUTTON_TODAY,
  BUTTON_COORDINATION,
] as const

export function mainKeyboard() {
  return new Keyboard()
    .text(BUTTON_NEW_TASK)
    .text(BUTTON_LOG_TIME)
    .row()
    .text(BUTTON_TODAY)
    .text(BUTTON_COORDINATION)
    .resized()
    .persistent()
}

/** Текст кнопки, а не обычное сообщение пользователя. */
export function isMainButton(text: string): text is (typeof MAIN_BUTTONS)[number] {
  return (MAIN_BUTTONS as readonly string[]).includes(text)
}
