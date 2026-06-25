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
  let initData = getInitData()
  // На iOS WKWebView SDK иногда инициализируется чуть позже первого fetch'а
  // со страницы. Если initData пустой — дождёмся появления WebApp до 2с.
  if (!initData) {
    await whenWebAppReady()
    initData = getInitData()
  }
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

/**
 * Дожидается появления window.Telegram.WebApp и вызывает .ready().
 * На iOS WKWebView SDK иногда инициализируется чуть позже первого React-эффекта —
 * ретраем с шагом 50ms до timeoutMs. Возвращает WebApp или null, если не дождались.
 */
export async function whenWebAppReady(timeoutMs = 2000): Promise<TelegramWebApp | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const wa = getWebApp()
    if (wa) {
      wa.ready()
      return wa
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  return null
}

/** Расширить Mini App на весь экран */
export function webAppExpand() {
  getWebApp()?.expand()
}

/**
 * Отключить вертикальный свайп вниз, который закрывает Mini App.
 * Доступно с Bot API 7.7 (Telegram 10.13+). На старых клиентах метода нет —
 * молча игнорируем.
 */
export function webAppDisableVerticalSwipes() {
  const wa = getWebApp()
  if (wa && typeof wa.disableVerticalSwipes === 'function') {
    wa.disableVerticalSwipes()
  }
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
  disableVerticalSwipes?: () => void
  enableVerticalSwipes?: () => void
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
