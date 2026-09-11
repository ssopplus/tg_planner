/**
 * Разбор тикета по связкам «очередь → проект».
 *
 * Одна очередь Трекера может обслуживать несколько проектов планировщика:
 * в очереди VDHWEBNEW («ВодоходЪ Сайт 2027») задачи интура помечены префиксом
 * «WEB Интур //», а компонентов и тегов у тикетов нет — заголовок остаётся
 * единственным машинным признаком. Поэтому связка может нести фильтр по
 * подстроке заголовка, а связка без фильтра забирает всё остальное.
 */

export interface QueueLinkTarget {
  id: string
  name: string
}

export interface QueueLink {
  queueKey: string
  titleFilter: string | null
  project: QueueLinkTarget
}

/**
 * Упорядочивает связки для разбора: сначала с фильтром, длинный фильтр раньше.
 *
 * Длина как мера специфичности: если заголовку подходят и «WEB Интур», и
 * «WEB Интур // Формы», победить должно более узкое правило. Без сортировки
 * результат зависел бы от порядка строк в БД.
 */
export function sortLinksForMatching(links: QueueLink[]): QueueLink[] {
  return [...links].sort((a, b) => (b.titleFilter?.length ?? 0) - (a.titleFilter?.length ?? 0))
}

/**
 * Возвращает проект для тикета или null, если очередь ни с чем не связана
 * (тогда синк пропускает тикет — это не наш поток задач).
 *
 * @param links — связки пользователя; порядок не важен, функция сортирует сама.
 */
export function resolveProjectForIssue(
  links: QueueLink[],
  issue: { queue: { key: string }; summary: string },
): QueueLinkTarget | null {
  const queueKey = issue.queue.key.toUpperCase()
  const forQueue = sortLinksForMatching(links).filter((l) => l.queueKey.toUpperCase() === queueKey)
  if (forQueue.length === 0) return null

  const summary = issue.summary.toLowerCase()
  const matched = forQueue.find(
    (l) => l.titleFilter && summary.includes(l.titleFilter.toLowerCase()),
  )
  if (matched) return matched.project

  return forQueue.find((l) => !l.titleFilter)?.project ?? null
}
