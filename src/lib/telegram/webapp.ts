'use client'

/**
 * Утилиты для работы с Telegram WebApp SDK на клиенте.
 */

/** Получить объект WebApp (доступен только в Telegram) */
export function getWebApp() {
  if (typeof window === 'undefined') return null
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null
}

/** Получить initData для авторизации API-запросов */
export function getInitData(): string {
  return getWebApp()?.initData ?? ''
}

/** Получить themeParams для адаптации UI */
export function getThemeParams() {
  return getWebApp()?.themeParams ?? null
}

/** Авторизованный fetch с initData в заголовке */
export async function apiFetch(url: string, options: RequestInit = {}) {
  const initData = getInitData()
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initData,
      ...options.headers,
    },
  })
}

/** Готовность WebApp */
export function webAppReady() {
  getWebApp()?.ready()
}

/** Расширить Mini App на весь экран */
export function webAppExpand() {
  getWebApp()?.expand()
}

/** Показать кнопку «Назад» */
export function showBackButton(callback: () => void) {
  const webapp = getWebApp()
  if (webapp?.BackButton) {
    webapp.BackButton.show()
    webapp.BackButton.onClick(callback)
  }
}

/** Скрыть кнопку «Назад» */
export function hideBackButton() {
  getWebApp()?.BackButton?.hide()
}

/** Telegram WebApp типы (базовые) */
interface TelegramWebApp {
  initData: string
  initDataUnsafe: Record<string, unknown>
  themeParams: ThemeParams
  ready: () => void
  expand: () => void
  close: () => void
  BackButton: {
    show: () => void
    hide: () => void
    onClick: (cb: () => void) => void
    offClick: (cb: () => void) => void
  }
  MainButton: {
    show: () => void
    hide: () => void
    setText: (text: string) => void
    onClick: (cb: () => void) => void
    offClick: (cb: () => void) => void
  }
  colorScheme: 'light' | 'dark'
}

interface ThemeParams {
  bg_color?: string
  text_color?: string
  hint_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  secondary_bg_color?: string
  header_bg_color?: string
  accent_text_color?: string
  section_bg_color?: string
  section_header_text_color?: string
  subtitle_text_color?: string
  destructive_text_color?: string
}
