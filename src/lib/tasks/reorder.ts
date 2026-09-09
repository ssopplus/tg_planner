/**
 * Ранжирование задач «по слотам».
 *
 * Порядок задач хранится глобально (`tasks.sort_order`), а разделы
 * («Трекер», «Внутренние») и фильтры — это вид поверх него. Поэтому
 * перетаскивание внутри раздела не должно двигать задачи, которых в нём не
 * видно: видимым задачам переприсваиваются те же позиции, которые они
 * занимали в глобальном списке, только в новом порядке.
 *
 * Пример: глобально A,B,C,D,E,F (позиции 0..5), видимы B,D,F (слоты 1,3,5).
 * Пользователь ставит их как F,B,D → F получает 1, B — 3, D — 5. Итог:
 * A,F,C,B,E,D. Скрытые A, C, E остались на позициях 0, 2, 4.
 */

/** Задача в глобальном списке: id и текущая сохранённая позиция. */
export interface RankedTask {
  id: string
  sortOrder: number
}

export interface ReorderResult {
  /** Позиции, которые надо записать в БД (только реально изменившиеся). */
  changes: Array<{ id: string; pos: number }>
  /** id из запроса, которых нет в глобальном списке. */
  unknownIds: string[]
}

/**
 * @param all — глобальный список активных задач пользователя, **уже
 *   отсортированный** так же, как его видит клиент (по sort_order, затем по
 *   created_at). Индекс в этом массиве и есть нормализованная позиция: пока
 *   ранжирования не было, все sort_order равны 0, и позиции берутся из
 *   порядка сортировки.
 * @param orderedIds — новый порядок видимых задач.
 */
export function computeSlotReorder(all: RankedTask[], orderedIds: string[]): ReorderResult {
  const positionById = new Map(all.map((t, i) => [t.id, i]))

  const unknownIds = orderedIds.filter((id) => !positionById.has(id))
  if (unknownIds.length > 0) return { changes: [], unknownIds }

  // Слоты видимых задач — их прежние позиции, по возрастанию.
  const slots = orderedIds.map((id) => positionById.get(id)!).sort((a, b) => a - b)

  const target = new Map(positionById)
  orderedIds.forEach((id, i) => target.set(id, slots[i]))

  const currentById = new Map(all.map((t) => [t.id, t.sortOrder]))
  const changes = [...target.entries()]
    .filter(([id, pos]) => currentById.get(id) !== pos)
    .map(([id, pos]) => ({ id, pos }))

  return { changes, unknownIds: [] }
}
