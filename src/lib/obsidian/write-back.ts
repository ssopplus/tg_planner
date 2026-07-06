/**
 * Write-back изменений задачи из tg-planer обратно в markdown-строку vault.
 * Чистая функция: принимает исходный markdown + UUID + желаемые изменения,
 * возвращает новый markdown. Никакого fetch.
 *
 * Логика поиска строки: ищем `<!--tgp:<uuid>-->` в первой встреченной
 * checkbox-строке. Если UUID нет — возвращает markdown без изменений
 * (для новых задач write-back не нужен, они ещё не пришли из vault).
 */

const CHECKBOX_RE = /^(\s*)-\s+\[([ xX])\]\s+(.*)$/
// Все regex с emoji — под флагом `u`, иначе character class рвёт surrogate-пары
// (высокий байт 0xD83D делят 📅, 🔼, 🔽 — без флага удаление приоритета обрубает
// половину 📅 и получается lone surrogate).
const DUE_RE = /📅\s*\d{4}-\d{2}-\d{2}/u
const PRIORITY_ANY_RE = /[⏫🔼🔽]/gu

export interface TaskWriteBackUpdates {
  /** Новый статус — true = DONE. Undefined = не трогать. */
  isCompleted?: boolean
  /** Новый дедлайн YYYY-MM-DD, `null` = убрать, `undefined` = не трогать. */
  due?: string | null
  /** Новый приоритет, `null` = убрать, `undefined` = не трогать. */
  priority?: 'HIGH' | 'MEDIUM' | 'LOW' | null
}

/**
 * Патчит одну строку. Возвращает либо новую строку, либо `null` если ничего
 * не поменялось (тогда caller решит не делать коммит).
 */
export function patchTaskLine(line: string, updates: TaskWriteBackUpdates): string | null {
  const match = line.match(CHECKBOX_RE)
  if (!match) return null

  const [, indent, mark, body] = match
  let newMark = mark
  let newBody = body

  if (updates.isCompleted !== undefined) {
    newMark = updates.isCompleted ? 'x' : ' '
  }

  if (updates.due !== undefined) {
    // Удаляем существующий дедлайн, потом при необходимости вставляем новый
    // перед trailing-анкером (или в конец, если анкера нет).
    newBody = newBody.replace(DUE_RE, '').replace(/\s{2,}/g, ' ').trim()
    if (updates.due) {
      newBody = insertBeforeAnchor(newBody, `📅 ${updates.due}`)
    }
  }

  if (updates.priority !== undefined) {
    newBody = newBody.replace(PRIORITY_ANY_RE, '').replace(/\s{2,}/g, ' ').trim()
    if (updates.priority) {
      const emoji = updates.priority === 'HIGH' ? '⏫' : updates.priority === 'MEDIUM' ? '🔼' : '🔽'
      newBody = insertBeforeAnchor(newBody, emoji)
    }
  }

  const newLine = `${indent}- [${newMark}] ${newBody}`
  return newLine === line ? null : newLine
}

/**
 * Вставляет фрагмент перед trailing `<!--tgp:UUID-->` анкером, если он есть,
 * иначе в конец. Так порядок «title метки… анкер» сохраняется.
 */
function insertBeforeAnchor(body: string, fragment: string): string {
  const anchorMatch = body.match(/(<!--tgp:[^>]+-->)\s*$/)
  if (anchorMatch) {
    const idx = anchorMatch.index ?? body.length
    const before = body.slice(0, idx).trimEnd()
    const anchor = anchorMatch[1]
    return `${before} ${fragment} ${anchor}`.replace(/\s{2,}/g, ' ').trim()
  }
  return `${body.trimEnd()} ${fragment}`.replace(/\s{2,}/g, ' ').trim()
}

/**
 * Находит в markdown строку с `<!--tgp:<uuid>-->` и применяет патч.
 * Возвращает новый текст файла или `null` — если такой строки нет
 * или патч не изменил её.
 */
export function applyTaskWriteBack(
  markdown: string,
  taskUuid: string,
  updates: TaskWriteBackUpdates,
): string | null {
  const anchor = `<!--tgp:${taskUuid}-->`
  const lines = markdown.split('\n')
  let hitIdx = -1

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(anchor)) {
      hitIdx = i
      break
    }
  }
  if (hitIdx === -1) return null

  const patched = patchTaskLine(lines[hitIdx], updates)
  if (patched === null) return null

  lines[hitIdx] = patched
  return lines.join('\n')
}
