/**
 * Импорт проектов из Obsidian-vault в БД tg-planer.
 *
 * Источник: /Users/vilch/Разработка/Документация/Проекты/{Vodohod,Личное}/<slug>/index.md
 *
 * Алгоритм:
 * 1. Discovery: сканируем Vodohod/Projects/ и Личное/project/, находим папки
 *    с .git, для которых в vault ещё нет заметки. Создаём шаблонные
 *    index.md + tasks.md — категория Vodohod/Личное определяется по корню.
 *    Мультирепо-slug'и (frontmatter.repos) считаются занятыми, чтобы pola-erp
 *    не превратилось обратно в три отдельных проекта. Инфра-каталоги
 *    (ansible) — в IGNORED_REPO_SLUGS.
 * 2. Сканируем все index.md в Документация/Проекты/.
 * 3. Парсим frontmatter и тело.
 * 4. Определяем kind и repo_path/repo_paths: ищем папки-репозитории.
 * 5. UPSERT в projects по (userId, slug). Tasks не трогаем.
 *
 * Запуск: pnpm tsx scripts/sync-vault-projects.ts [--user-id=<id>] [--no-discover]
 * Если --user-id не указан — синхронизируется для всех пользователей.
 * --no-discover — пропустить создание новых заметок vault, только импорт из
 *   уже существующих (полезно при отладке).
 */

import 'dotenv/config'
import {
  readdirSync,
  readFileSync,
  existsSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { db } from '../src/lib/db'
import { users, projects } from '../src/lib/db/schema'
import { and, eq } from 'drizzle-orm'

const WORKSPACE_ROOT = '/Users/vilch/Разработка'
const VAULT_PROJECTS_DIR = resolve(WORKSPACE_ROOT, 'Документация/Проекты')
const REPO_SEARCH_ROOTS = [
  resolve(WORKSPACE_ROOT, 'Vodohod/Projects'),
  resolve(WORKSPACE_ROOT, 'Личное/project'),
]

interface RepoEntry {
  slug: string
  name: string
  path: string
}

interface VaultProject {
  slug: string
  name: string
  vaultPath: string
  description: string | null
  techStack: string[] | null
  tags: string[] | null
  kind: 'dev' | 'general'
  repoPath: string | null
  repoPaths: RepoEntry[] | null
}

// === Парсинг ===

function parseFrontmatter(content: string): { fm: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { fm: {}, body: content }

  const fm: Record<string, unknown> = {}
  const rawLines = match[1].split('\n')

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (!kv) continue
    const [, key, rawValue] = kv
    const value = rawValue.trim()

    // Inline-array: tags: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      fm[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
      continue
    }

    // Block-array of objects (2-пробельный YAML-стиль Obsidian):
    //   repos:
    //     - slug: erp
    //       name: Backend (Go)
    // Проще: считаем отступ первого "-" и любые последующие поля с бОльшим отступом.
    if (value === '' && rawLines[i + 1]?.match(/^\s+-\s/)) {
      const firstItem = rawLines[i + 1]
      const itemIndent = firstItem.match(/^(\s*)-/)?.[1].length ?? 0
      const items: Array<Record<string, string>> = []
      let current: Record<string, string> | null = null
      let j = i + 1
      while (j < rawLines.length) {
        const l = rawLines[j]
        const leadingSpaces = l.match(/^(\s*)/)?.[1].length ?? 0
        const trimmed = l.trim()

        if (trimmed === '') {
          j++
          continue
        }

        // Новый элемент: "- key: value" на уровне itemIndent
        const itemStart = l.match(/^\s*-\s+(\w+):\s*(.*)$/)
        if (itemStart && leadingSpaces === itemIndent) {
          if (current) items.push(current)
          current = { [itemStart[1]]: itemStart[2].trim().replace(/^["']|["']$/g, '') }
          j++
          continue
        }

        // Продолжение элемента: "  key: value" с отступом больше itemIndent
        const itemField = l.match(/^\s*(\w+):\s*(.*)$/)
        if (itemField && current && leadingSpaces > itemIndent) {
          current[itemField[1]] = itemField[2].trim().replace(/^["']|["']$/g, '')
          j++
          continue
        }

        // Не наш блок — вышли
        break
      }
      if (current) items.push(current)
      if (items.length > 0) {
        fm[key] = items
        i = j - 1
        continue
      }
    }

    // Plain string
    fm[key] = value.replace(/^["']|["']$/g, '')
  }
  return { fm, body: match[2] }
}

/**
 * Извлекает первый абзац из тела заметки как краткое описание.
 * Заметки имеют структуру: # Заголовок, далее короткий вводный абзац.
 */
function extractDescription(body: string): string | null {
  const lines = body.split('\n')
  let i = 0
  // Пропускаем H1
  while (i < lines.length && !lines[i].startsWith('#')) i++
  while (i < lines.length && lines[i].startsWith('#')) i++
  while (i < lines.length && !lines[i].trim()) i++
  // Собираем подряд непустые строки до первой пустой/заголовка
  const buf: string[] = []
  while (i < lines.length && lines[i].trim() && !lines[i].startsWith('#')) {
    buf.push(lines[i].trim())
    i++
  }
  const text = buf.join(' ').trim()
  return text || null
}

/**
 * Извлекает элементы из секции "## Технологии" (или другой).
 * Возвращает чистый текст без [[wiki-ссылок]] и markdown-ссылок.
 */
function extractListSection(body: string, sectionTitle: string): string[] {
  const re = new RegExp(`##\\s+${sectionTitle}\\b([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i')
  const match = body.match(re)
  if (!match) return []

  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-'))
    .map((line) => line.replace(/^-\s*/, ''))
    .map((line) => line.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')) // [[wiki]] / [[wiki|alias]]
    .map((line) => line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')) // [text](url)
    .map((line) => line.replace(/\s*—.*$/, '').trim()) // отрезаем " — комментарий"
    .filter(Boolean)
}

/**
 * Ищет папку репозитория, соответствующую slug.
 * Учитывает суффиксы вроде "-master" (b2c-site-symfony ↔ b2c-site-symfony-master).
 */
function findRepoPath(slug: string): string | null {
  for (const root of REPO_SEARCH_ROOTS) {
    if (!existsSync(root)) continue
    const entries = readdirSync(root)

    // Точное совпадение
    if (entries.includes(slug)) {
      const path = join(root, slug)
      if (statSync(path).isDirectory()) return path
    }

    // С суффиксом -master / -main и т.п.
    const prefixed = entries.find((e) => e.startsWith(`${slug}-`) || e === slug)
    if (prefixed) {
      const path = join(root, prefixed)
      if (statSync(path).isDirectory()) return path
    }
  }
  return null
}

function loadVaultProject(filePath: string): VaultProject {
  const content = readFileSync(filePath, 'utf-8')
  const { fm, body } = parseFrontmatter(content)

  // Структура: .../Проекты/<категория>/<slug>/index.md → slug = имя родительской папки.
  const parts = filePath.split('/')
  const slug = parts[parts.length - 2]

  const h1 = body.match(/^#\s+(.+)$/m)
  const name = (h1?.[1] ?? slug).trim()

  // Мультирепо: если во frontmatter есть repos: — резолвим каждый по slug.
  let repoPaths: RepoEntry[] | null = null
  const fmRepos = fm.repos as Array<Record<string, string>> | undefined
  if (fmRepos && fmRepos.length > 0) {
    const resolved: RepoEntry[] = []
    for (const r of fmRepos) {
      if (!r.slug) continue
      const path = findRepoPath(r.slug)
      if (path) resolved.push({ slug: r.slug, name: r.name || r.slug, path })
    }
    if (resolved.length > 0) repoPaths = resolved
  }

  // Одиночное репо: если repoPaths не задан, ищем по slug проекта.
  const repoPath = repoPaths ? null : findRepoPath(slug)
  const techStack = extractListSection(body, 'Технологии')

  const isDev = Boolean(repoPath) || (repoPaths?.length ?? 0) > 0

  return {
    slug,
    name,
    vaultPath: relative(WORKSPACE_ROOT, filePath),
    description: extractDescription(body),
    techStack: techStack.length > 0 ? techStack : null,
    tags: (fm.tags as string[] | undefined) ?? null,
    kind: isDev ? 'dev' : 'general',
    repoPath,
    repoPaths,
  }
}

/**
 * Соответствие корня репозиториев → категории vault.
 * Vodohod/Projects/ → «Vodohod», Личное/project/ → «Личное».
 */
const REPO_ROOT_TO_CATEGORY: Record<string, string> = {
  [resolve(WORKSPACE_ROOT, 'Vodohod/Projects')]: 'Vodohod',
  [resolve(WORKSPACE_ROOT, 'Личное/project')]: 'Личное',
}

const INDEX_MD_TEMPLATE = (slug: string, category: string) => `---
tags: [проект, ${category.toLowerCase()}]
project: ${slug}
status: active
---

# ${slug}

TODO: краткое описание проекта в одну-две строки.

## Описание

TODO: что за продукт, для кого, какую задачу решает.

## Технологии

- TODO

## Связанные проекты

- TODO

## Назад

← [[${category}]]
`

const TASKS_MD_TEMPLATE = `# Задачи

Активные задачи проекта. Каждая строка \`- [ ] ...\` синхронизируется с tg-planer.

Формат: \`- [ ] заголовок 📅 YYYY-MM-DD ⏫\` (⏫=HIGH, 🔼=MEDIUM, 🔽=LOW).
После синхронизации в конец строки добавляется \`<!--tgp:UUID-->\` — не удаляй
этот маркер, по нему трекер находит задачу при следующих правках.

---

`

/**
 * Возвращает slug'и всех репозиториев, уже «занятых» проектами vault:
 *  - имя папки проекта (Документация/Проекты/<категория>/<slug>/index.md);
 *  - slug'и из фронтматтера `repos:` — для мультирепо-проектов (pola-erp
 *    оборачивает erp + pola-tech-front + master-reporting-tool-electron).
 * Без этого discovery-фаза попыталась бы создать отдельные заметки для
 * репозиториев, которые уже склеены в один проект.
 */
function collectExistingVaultSlugs(): Set<string> {
  const slugs = new Set<string>()
  for (const category of readdirSync(VAULT_PROJECTS_DIR)) {
    const categoryPath = join(VAULT_PROJECTS_DIR, category)
    if (!statSync(categoryPath).isDirectory()) continue
    for (const entry of readdirSync(categoryPath)) {
      const projectDir = join(categoryPath, entry)
      if (!statSync(projectDir).isDirectory()) continue
      const indexPath = join(projectDir, 'index.md')
      if (!existsSync(indexPath)) continue
      slugs.add(entry)

      // Подхватываем slug'и вложенных репозиториев из frontmatter.repos.
      const { fm } = parseFrontmatter(readFileSync(indexPath, 'utf-8'))
      const repos = fm.repos as Array<Record<string, string>> | undefined
      if (repos) for (const r of repos) if (r.slug) slugs.add(r.slug)
    }
  }
  return slugs
}

/**
 * Инфра-каталоги в Vodohod/Projects/, которые не проекты в смысле tg-planer.
 * Скрипт discovery их пропускает.
 */
const IGNORED_REPO_SLUGS = new Set(['ansible'])

/**
 * Ищет git-репозитории в REPO_SEARCH_ROOTS, для которых ещё нет заметки в vault,
 * и создаёт шаблонные index.md + tasks.md. Возвращает список созданных slug'ов.
 *
 * Критерий «репозиторий» — папка с подкаталогом `.git`. Отсеивает служебные
 * директории вроде `ansible`, `node_modules` и т.п. без .git внутри.
 */
function discoverNewProjectsAndCreateNotes(): string[] {
  const knownSlugs = collectExistingVaultSlugs()
  const created: string[] = []

  for (const root of REPO_SEARCH_ROOTS) {
    if (!existsSync(root)) continue
    const category = REPO_ROOT_TO_CATEGORY[root]
    if (!category) continue

    for (const entry of readdirSync(root)) {
      // Игнорируем скрытые/dot-файлы и явно неинтересные инфра-репы
      if (entry.startsWith('.')) continue
      if (IGNORED_REPO_SLUGS.has(entry)) continue
      const repoPath = join(root, entry)
      if (!statSync(repoPath).isDirectory()) continue
      if (!existsSync(join(repoPath, '.git'))) continue

      // Возможные варианты slug'а, под которыми проект может быть уже описан в vault.
      const candidates = [entry, entry.replace(/-master$/, ''), entry.replace(/-main$/, '')]
      if (candidates.some((c) => knownSlugs.has(c))) continue

      // Slug для vault совпадает с именем папки; при желании потом переименуешь.
      const slug = entry
      const vaultProjectDir = join(VAULT_PROJECTS_DIR, category, slug)
      mkdirSync(vaultProjectDir, { recursive: true })
      writeFileSync(join(vaultProjectDir, 'index.md'), INDEX_MD_TEMPLATE(slug, category), 'utf-8')
      writeFileSync(join(vaultProjectDir, 'tasks.md'), TASKS_MD_TEMPLATE, 'utf-8')
      created.push(slug)
    }
  }

  return created
}

function scanVaultProjects(): VaultProject[] {
  const result: VaultProject[] = []
  for (const category of readdirSync(VAULT_PROJECTS_DIR)) {
    const categoryPath = join(VAULT_PROJECTS_DIR, category)
    if (!statSync(categoryPath).isDirectory()) continue
    // Структура: Проекты/<категория>/<slug>/index.md
    for (const entry of readdirSync(categoryPath)) {
      const projectDir = join(categoryPath, entry)
      if (!statSync(projectDir).isDirectory()) continue
      const indexPath = join(projectDir, 'index.md')
      if (!existsSync(indexPath)) continue
      result.push(loadVaultProject(indexPath))
    }
  }
  return result.sort((a, b) => a.slug.localeCompare(b.slug))
}

// === UPSERT ===

async function upsertForUser(userId: string, vaultProjects: VaultProject[]): Promise<{
  created: number
  updated: number
}> {
  let created = 0
  let updated = 0

  for (const vp of vaultProjects) {
    const [existing] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.slug, vp.slug)))
      .limit(1)

    if (existing) {
      await db
        .update(projects)
        .set({
          name: vp.name,
          vaultPath: vp.vaultPath,
          description: vp.description,
          techStack: vp.techStack,
          tags: vp.tags,
          kind: vp.kind,
          repoPath: vp.repoPath,
          repoPaths: vp.repoPaths,
        })
        .where(eq(projects.id, existing.id))
      updated++
    } else {
      await db.insert(projects).values({
        userId,
        name: vp.name,
        slug: vp.slug,
        vaultPath: vp.vaultPath,
        description: vp.description,
        techStack: vp.techStack,
        tags: vp.tags,
        kind: vp.kind,
        repoPath: vp.repoPath,
        repoPaths: vp.repoPaths,
      })
      created++
    }
  }

  return { created, updated }
}

// === Main ===

async function main() {
  const args = process.argv.slice(2)
  const userIdArg = args.find((a) => a.startsWith('--user-id='))?.split('=')[1]
  const skipDiscover = args.includes('--no-discover')

  if (!skipDiscover) {
    const discovered = discoverNewProjectsAndCreateNotes()
    if (discovered.length > 0) {
      console.log(`Создано ${discovered.length} новых заметок в vault:`)
      for (const slug of discovered) console.log(`  + ${slug}`)
      console.log()
    }
  }

  const vaultProjects = scanVaultProjects()
  console.log(`Найдено ${vaultProjects.length} проектов в vault:`)
  for (const vp of vaultProjects) {
    if (vp.repoPaths && vp.repoPaths.length > 0) {
      console.log(`  - ${vp.slug.padEnd(24)} [${vp.kind}] мультирепо (${vp.repoPaths.length})`)
      for (const r of vp.repoPaths) console.log(`      · ${r.slug} → ${r.path}`)
    } else {
      console.log(
        `  - ${vp.slug.padEnd(24)} [${vp.kind}]${vp.repoPath ? ` → ${vp.repoPath}` : ''}`,
      )
    }
  }

  const targetUsers = userIdArg
    ? [{ id: userIdArg }]
    : await db.select({ id: users.id }).from(users)

  if (targetUsers.length === 0) {
    console.log('\nПользователи не найдены. Создайте пользователя через /start в боте.')
    return
  }

  console.log(`\nСинхронизация для ${targetUsers.length} пользователей...`)
  for (const u of targetUsers) {
    const { created, updated } = await upsertForUser(u.id, vaultProjects)
    console.log(`  user=${u.id}: создано ${created}, обновлено ${updated}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
