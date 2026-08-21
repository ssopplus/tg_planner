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

/** Значение tasks.externalSource для задач, которые синхронизированы с YT. */
export const EXTERNAL_SOURCE_TRACKER = 'yandex-tracker'

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
 * Организация: vodohod.ru (Яндекс 360, org-7026646). Заголовок X-Org-ID,
 * значение из env YANDEX_TRACKER_ORG_ID=7026646.
 *
 * Актуально с 2026-07 (переезд на организацию vodohod.ru):
 * - POLAERP (Пола Ерп) → pola-erp
 * - остальные очереди vodohod.ru (SH, WEBSH, VDHWEBNEW, WEB, AIBOT, …)
 *   → пока не синхронизируем (нет назначенных задач / не решено)
 *
 * Прежняя организация (org-8347940) отключена: очередь SHWEB там больше
 * не используется, её маппинг на SwanHellenic снят.
 */
export const QUEUE_TO_PROJECT_SLUG: Record<string, string> = {
  POLAERP: 'pola-erp',
}

/**
 * Закрывает тикет в YT через transition.
 *
 * Поведение:
 * 1. Запрашиваем доступные переходы тикета.
 * 2. Ищем переход в статус "закрыт"/"решён" — у разных очередей id отличается
 *    (POLAERP: id=close, SHWEB: id=closed). Сравниваем по to.key.
 * 3. POST по найденному id с resolution=fixed (без resolution YT отвечает 422
 *    на очередях, где экран перехода требует поле).
 *
 * Возвращает true если переход выполнен, false если не нашли подходящий
 * или YT отверг — но не бросает (закрытие в YT не должно мешать локальному DONE).
 */
const CLOSED_STATUS_KEYS = new Set(['closed', 'resolved'])

export async function closeIssue(args: {
  token: string
  orgId: string
  issueKey: string
}): Promise<{ ok: boolean; transitionId?: string; reason?: string }> {
  const headers = authHeaders(args.token, args.orgId)

  const listRes = await fetch(`${BASE}/issues/${args.issueKey}/transitions`, {
    headers,
  })
  if (!listRes.ok) {
    return { ok: false, reason: `list transitions ${listRes.status}: ${await listRes.text()}` }
  }
  const transitions = (await listRes.json()) as Array<{
    id: string
    to: { key: string }
  }>

  const target = transitions.find((t) => CLOSED_STATUS_KEYS.has(t.to.key))
  if (!target) {
    return {
      ok: false,
      reason: `no closing transition (available: ${transitions.map((t) => t.to.key).join(',')})`,
    }
  }

  const execRes = await fetch(
    `${BASE}/issues/${args.issueKey}/transitions/${target.id}/_execute`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ resolution: 'fixed' }),
    },
  )
  if (!execRes.ok) {
    return {
      ok: false,
      transitionId: target.id,
      reason: `execute ${execRes.status}: ${await execRes.text()}`,
    }
  }
  return { ok: true, transitionId: target.id }
}
