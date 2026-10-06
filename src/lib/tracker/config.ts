/**
 * Доступ к Трекеру живёт в переменных окружения и только на сервере.
 * Роуты вызывают эту функцию вместо того, чтобы каждый раз перепроверять
 * обе переменные и выдумывать свой текст ошибки.
 */
export function trackerConfig(): { token: string; orgId: string } | null {
  const token = process.env.YANDEX_TRACKER_TOKEN
  const orgId = process.env.YANDEX_TRACKER_ORG_ID
  if (!token || !orgId) return null
  return { token, orgId }
}

/** Текст, который видит пользователь, когда Трекер не настроен. */
export const TRACKER_NOT_CONFIGURED = 'Трекер не настроен: нет токена или Org-ID'
