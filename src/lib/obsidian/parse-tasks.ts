/**
 * Парсер чек-боксов из markdown-заметок Obsidian в формате Tasks-emoji.
 *
 * Поддерживаемые маркеры (см. https://publish.obsidian.md/tasks/Reference/Task+Formats/Tasks+Emoji+Format):
 * - [ ] / [x]            — статус (TODO / DONE)
 * - 📅 2026-05-25         — дедлайн (due)
 * - ⏫ / 🔼 / 🔽           — приоритет (HIGH / MEDIUM / LOW)
 * - #project/<slug>       — переопределение проекта (если задано — приоритет над путём файла)
 * - <!--tgp:UUID-->       — анкер задачи в БД tg-planer (для идемпотентности)
 *
 * Эта функция чистая: никаких побочных эффектов, никакого fetch.
 * Возвращает список разобранных задач — что с ними делать дальше решает
 * вызывающий код (см. /api/sync/obsidian).
 */

export interface ObsidianTask {
  /** Сырая строка (без префиксного `- [ ]` и без меток) — заголовок задачи */
  title: string
  /** Статус из `[ ]` или `[x]` */
  isCompleted: boolean
  /** Дата дедлайна в формате YYYY-MM-DD, если 📅 присутствовала */
  due: string | null
  /** Приоритет, если ⏫/🔼/🔽 присутствовал */
  priority: 'HIGH' | 'MEDIUM' | 'LOW' | null
  /** Slug проекта из тега `#project/<slug>`, если задан */
  projectSlug: string | null
  /** UUID-анкер из `<!--tgp:UUID-->`, если задан (иначе null — задача новая) */
  tgpId: string | null
  /** Номер строки в файле (1-based) — нужен для write-back UUID */
  lineNumber: number
  /** Исходная строка целиком — нужна для write-back UUID, чтобы найти и заменить */
  raw: string
}

const CHECKBOX_RE = /^(\s*)-\s+\[([ xX])\]\s+(.*)$/
const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/
const PRIORITY_HIGH_RE = /⏫/
const PRIORITY_MEDIUM_RE = /🔼/
const PRIORITY_LOW_RE = /🔽/
const PROJECT_TAG_RE = /#project\/([a-z0-9_-]+)/i
const TGP_ID_RE = /<!--tgp:([a-zA-Z0-9_-]+)-->/

/**
 * Удаляет из строки все «системные» маркеры (даты, приоритет, тег, анкер),
 * оставляя только чистый текст заголовка. Без trim — это делает caller.
 */
function stripMarkers(text: string): string {
  return text
    .replace(DUE_RE, '')
    .replace(PRIORITY_HIGH_RE, '')
    .replace(PRIORITY_MEDIUM_RE, '')
    .replace(PRIORITY_LOW_RE, '')
    .replace(PROJECT_TAG_RE, '')
    .replace(TGP_ID_RE, '')
}

function detectPriority(text: string): 'HIGH' | 'MEDIUM' | 'LOW' | null {
  if (PRIORITY_HIGH_RE.test(text)) return 'HIGH'
  if (PRIORITY_MEDIUM_RE.test(text)) return 'MEDIUM'
  if (PRIORITY_LOW_RE.test(text)) return 'LOW'
  return null
}

export function parseObsidianTasks(markdown: string): ObsidianTask[] {
  const lines = markdown.split('\n')
  const tasks: ObsidianTask[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(CHECKBOX_RE)
    if (!match) continue

    const [, /* indent */, mark, body] = match
    const isCompleted = mark.toLowerCase() === 'x'

    const dueMatch = body.match(DUE_RE)
    const slugMatch = body.match(PROJECT_TAG_RE)
    const idMatch = body.match(TGP_ID_RE)
    const priority = detectPriority(body)

    const cleanTitle = stripMarkers(body).replace(/\s+/g, ' ').trim()
    if (!cleanTitle) continue

    tasks.push({
      title: cleanTitle,
      isCompleted,
      due: dueMatch?.[1] ?? null,
      priority,
      projectSlug: slugMatch?.[1] ?? null,
      tgpId: idMatch?.[1] ?? null,
      lineNumber: i + 1,
      raw: line,
    })
  }

  return tasks
}

/**
 * Извлекает slug проекта из пути файла vault.
 *
 * Структура: Проекты/<категория>/<slug>/tasks.md (или index.md).
 * Slug = имя папки проекта.
 *
 * Примеры:
 *   "Проекты/Vodohod/turbo-site/tasks.md"   → "turbo-site"
 *   "Проекты/Vodohod/turbo-site/index.md"   → "turbo-site"
 *   "Проекты/Личное/tg-planer/tasks.md"     → "tg-planer"
 *   "Темы/Боты.md"                          → null
 */
export function projectSlugFromVaultPath(vaultPath: string): string | null {
  const match = vaultPath.match(/(?:^|\/)Проекты\/[^/]+\/([^/]+)\/(?:tasks|index)\.md$/)
  return match?.[1] ?? null
}

/**
 * Проверяет, что путь указывает на файл задач (tasks.md проекта).
 * Только такие файлы попадают в синхронизацию tasks → БД.
 * index.md и любые другие .md в папке проекта игнорируются.
 */
export function isTasksFile(vaultPath: string): boolean {
  return /(?:^|\/)Проекты\/[^/]+\/[^/]+\/tasks\.md$/.test(vaultPath)
}
