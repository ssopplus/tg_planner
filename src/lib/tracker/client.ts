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
 * Ключи статусов Трекера, которые означают «задача больше не в работе».
 *
 * Нужны в двух местах: как YQL-фильтр выборки и как проверка на нашей стороне
 * (см. isActiveIssue). Второе — не паранойя: поисковый индекс Трекера отдаёт
 * неконсистентные данные, замер 08.09.2026 на орге vodohod.ru показал один и
 * тот же POLAERP-42 как «В работе» в одном ответе и «Закрыт» в другом.
 */
export const INACTIVE_STATUS_KEYS = new Set(['closed', 'cancelled', 'resolved', 'rejected'])

/** Активна ли задача по её статусу (страховка поверх YQL-фильтра). */
export function isActiveIssue(issue: Pick<TrackerIssue, 'status'>): boolean {
  return !INACTIVE_STATUS_KEYS.has(issue.status.key)
}

/**
 * Маппинг статуса Трекера → статус задачи tg-planer.
 *
 * Активные статусы Трекера делятся на «ещё не начато» и «уже в работе»:
 * open/backlog/asPlanned/needInfo → TODO, inProgress/testing/intest/review → IN_PROGRESS.
 * Неактивные статусы сюда не попадают — они отсекаются isActiveIssue до вызова.
 */
export function mapTrackerStatus(statusKey: string): 'TODO' | 'IN_PROGRESS' {
  switch (statusKey) {
    case 'inProgress':
    case 'inReview':
    case 'review':
    case 'testing':
    case 'intest':
    case 'readyForTest':
      return 'IN_PROGRESS'
    default:
      return 'TODO'
  }
}

/** Очередь Трекера в минимальном виде — для выбора в настройках. */
export interface TrackerQueue {
  key: string
  name: string
}

/**
 * Список очередей, доступных владельцу токена.
 *
 * Нужен экрану настроек, чтобы привязывать очереди к проектам выбором из
 * списка, а не вводом ключа руками. Очередей в организации порядка сотни,
 * поэтому листаем страницами; ограничение в 10 страниц — предохранитель от
 * бесконечного цикла, если API перестанет отдавать пустую последнюю страницу.
 */
export async function listQueues(args: {
  token: string
  orgId: string
}): Promise<TrackerQueue[]> {
  const headers = authHeaders(args.token, args.orgId)
  const result: TrackerQueue[] = []

  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${BASE}/queues?perPage=100&page=${page}`, { headers })
    if (!res.ok) throw new Error(`Tracker queues ${res.status}: ${await res.text()}`)

    const batch = (await res.json()) as Array<{ key: string; name?: string }>
    if (batch.length === 0) break
    result.push(...batch.map((q) => ({ key: q.key, name: q.name ?? q.key })))
    if (batch.length < 100) break
  }

  return result.sort((a, b) => a.key.localeCompare(b.key))
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
  //
  // ВАЖНО: раньше здесь стоял `Resolution: empty()` — он НЕ отсекает закрытые.
  // Замер 08.09.2026 (орга vodohod.ru): такой запрос вернул 10 тикетов, из них
  // 8 закрытых (POLAERP-2/17/28/42/55, SHWEB-144/266, AIBOT-121 «Отменено»).
  // Причина — в Трекере тикет можно закрыть переходом без резолюции, тогда
  // поле Resolution остаётся пустым. Отсекаем по статусу: тот же замер с
  // фильтром ниже дал ровно 17 активных из 62 тикетов на assignee=me.
  const queryParts = [
    'Assignee: me()',
    ...[...INACTIVE_STATUS_KEYS].map((key) => `Status: !${key}`),
  ]
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

  // Второй слой: отсекаем по статусу то, что просочилось через YQL.
  const issues = (await res.json()) as TrackerIssue[]
  return issues.filter(isActiveIssue)
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
