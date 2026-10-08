/**
 * Сравнение задачи Трекера с её прошлым снимком в БД.
 *
 * Логика чистая и без обращений к API: синк отдаёт сюда «было» и «стало», а
 * обратно получает список человеческих строк для уведомления. Так её можно
 * проверять отдельно от самого синка.
 */

/** Что именно изменилось — для возможного выключения отдельных видов. */
export type TaskChangeKind = 'status' | 'deadline' | 'priority' | 'title' | 'description'

export interface TaskChange {
  kind: TaskChangeKind
  /** Готовая строка сообщения, например «Статус: В работе → Тестируется». */
  text: string
}

/** Снимок полей задачи, по которым считается разница. */
export interface TaskSnapshot {
  title: string
  description: string | null
  /** Статус словами Трекера. NULL у задач, синхронизированных до этой фичи. */
  trackerStatus: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  deadlineAt: Date | null
}

const PRIORITY_LABEL: Record<TaskSnapshot['priority'], string> = {
  LOW: 'низкий',
  MEDIUM: 'обычный',
  HIGH: 'высокий',
}

/** Дата в виде «дд.мм.гггг»; время дедлайна в Трекере всегда конец дня. */
export function formatDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}.${month}.${d.getFullYear()}`
}

/** Сравнивает дедлайны по дню: время у них служебное (23:59:59). */
function sameDay(a: Date | null, b: Date | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return formatDate(a) === formatDate(b)
}

function trim(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Возвращает список изменений между снимками. Пустой список — задача не
 * менялась в том, что нам интересно (например, к ней только списали время).
 *
 * Статус сравнивается, только если прошлый известен: у задач, синхронизированных
 * до появления колонки, он NULL, и первый же прогон иначе прислал бы
 * уведомление об «изменении» на каждую активную задачу.
 */
export function diffTask(before: TaskSnapshot, after: TaskSnapshot): TaskChange[] {
  const changes: TaskChange[] = []

  if (before.trackerStatus && after.trackerStatus && before.trackerStatus !== after.trackerStatus) {
    changes.push({
      kind: 'status',
      text: `Статус: ${before.trackerStatus} → ${after.trackerStatus}`,
    })
  }

  if (!sameDay(before.deadlineAt, after.deadlineAt)) {
    const was = before.deadlineAt ? formatDate(before.deadlineAt) : 'без дедлайна'
    const now = after.deadlineAt ? formatDate(after.deadlineAt) : 'снят'
    changes.push({ kind: 'deadline', text: `Дедлайн: ${was} → ${now}` })
  }

  if (before.priority !== after.priority) {
    changes.push({
      kind: 'priority',
      text: `Приоритет: ${PRIORITY_LABEL[before.priority]} → ${PRIORITY_LABEL[after.priority]}`,
    })
  }

  if (before.title !== after.title) {
    changes.push({ kind: 'title', text: `Заголовок: ${trim(after.title, 60)}` })
  }

  // Текст описания не показываем: он бывает на экран, а в уведомлении важен
  // сам факт — подробности пользователь увидит в карточке.
  if ((before.description ?? '') !== (after.description ?? '')) {
    changes.push({ kind: 'description', text: 'Описание изменилось' })
  }

  return changes
}
