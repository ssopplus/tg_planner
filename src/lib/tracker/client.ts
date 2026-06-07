/**
 * Минимальный клиент Yandex Tracker REST API для синхронизации задач.
 * Документация: https://yandex.cloud/ru/docs/tracker/about-api
 *
 * Auth: OAuth-токен (получается через oauth.yandex.ru/client с правом Tracker).
 *       Org-ID — Yandex 360 формат "org-XXXXXX", передаётся в X-Org-ID.
 *
 * Хранится в env:
 *   YANDEX_TRACKER_TOKEN
 *   YANDEX_TRACKER_ORG_ID
 */

const BASE = 'https://api.tracker.yandex.net/v2'

function authHeaders(token: string, orgId: string) {
  return {
    Authorization: `OAuth ${token}`,
    'X-Org-ID': orgId,
    'Content-Type': 'application/json',
  }
}

export interface TrackerIssue {
  /** Ключ задачи, например "SHWEB-264". Используется как external_id в БД. */
  key: string
  summary: string
  description?: string
  status: { key: string; display: string }
  queue: { key: string; display: string }
  priority?: { key: string; display: string }
  deadline?: string // YYYY-MM-DD
  updatedAt: string // ISO datetime
  createdAt: string
}

/**
 * Возвращает активные задачи текущего пользователя (assignee=me()).
 * Активные = всё кроме closed/resolved/cancelled.
 *
 * Параметр updatedSince позволяет ограничиться тикетами, изменёнными после
 * последнего успешного синка — экономит вызовы YT при cron-сценарии.
 */
export async function listMyActiveIssues(args: {
  token: string
  orgId: string
  updatedSince?: Date
}): Promise<TrackerIssue[]> {
  // Tracker Search API: POST /v2/issues/_search с фильтром.
  // Используем язык запросов, потому что фильтр-объект не умеет "isn't"
  // одновременно по нескольким значениям статуса.
  const queryParts = ['Assignee: me()', 'Resolution: empty()']
  if (args.updatedSince) {
    // YT хочет дату в формате "YYYY-MM-DD HH:mm" UTC.
    const iso = args.updatedSince.toISOString().slice(0, 16).replace('T', ' ')
    queryParts.push(`Updated: > "${iso}"`)
  }
  const query = queryParts.join(' AND ')

  const res = await fetch(`${BASE}/issues/_search?perPage=100`, {
    method: 'POST',
    headers: authHeaders(args.token, args.orgId),
    body: JSON.stringify({ query }),
  })

  if (!res.ok) {
    throw new Error(`Tracker search ${res.status}: ${await res.text()}`)
  }

  return (await res.json()) as TrackerIssue[]
}

/** Маппинг приоритета YT в приоритет tg-planer. Незнакомые → MEDIUM. */
export function mapTrackerPriority(
  trackerKey: string | undefined,
): 'LOW' | 'MEDIUM' | 'HIGH' {
  switch (trackerKey) {
    case 'blocker':
    case 'critical':
      return 'HIGH'
    case 'minor':
    case 'trivial':
      return 'LOW'
    default:
      return 'MEDIUM'
  }
}

/**
 * Маппинг ключа очереди YT → slug проекта в БД tg-planer.
 * Очереди без маппинга игнорируются при синке.
 *
 * Согласовано 2026-06-03:
 * - SHWEB (SH Web Development) → turbo-site
 * - POLAERP (Pola ERP) → pola-erp
 * - остальные (DEV, MARKETING, AIBOT, …) → пока не синхронизируем
 */
export const QUEUE_TO_PROJECT_SLUG: Record<string, string> = {
  SHWEB: 'turbo-site',
  POLAERP: 'pola-erp',
}
