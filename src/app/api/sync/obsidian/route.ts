import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { tasks, projects, users } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  parseObsidianTasks,
  projectSlugFromVaultPath,
  type ObsidianTask,
} from '@/lib/obsidian/parse-tasks'
import { getCommitDiff, getFileContents, putFileContents } from '@/lib/github/client'

/**
 * GitHub webhook handler для синхронизации Obsidian-vault → tg-planer.
 *
 * Поток:
 *   obsidian-git autocommit → push в vault-репо → GitHub доставляет push event сюда
 *
 * Эндпоинт идемпотентен. Привязка задачи к строке в vault — через анкер
 * `<!--tgp:<task.id>-->`. Если анкера в строке нет — он добавляется
 * write-back-коммитом после создания задачи.
 *
 * Один аккаунт (single-user MVP): user_id определяется через env
 * OBSIDIAN_SYNC_USER_ID, либо берётся единственный user из БД.
 *
 * Required env:
 *   GITHUB_WEBHOOK_SECRET — секрет, заданный в настройках вебхука GitHub
 *   GITHUB_VAULT_TOKEN    — PAT с правом repo на vault-репозиторий
 *   OBSIDIAN_SYNC_USER_ID — (опц.) UUID конкретного пользователя; иначе single-user
 */

interface GithubPushPayload {
  ref: string
  before: string
  after: string
  repository: {
    name: string
    owner: { login: string }
    default_branch: string
  }
  commits: Array<{ id: string; message: string }>
}

function verifySignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(body, 'utf-8')
  const expected = `sha256=${hmac.digest('hex')}`
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

async function resolveUserId(): Promise<string | null> {
  const fromEnv = process.env.OBSIDIAN_SYNC_USER_ID
  if (fromEnv) return fromEnv
  const allUsers = await db.select({ id: users.id }).from(users).limit(2)
  if (allUsers.length === 1) return allUsers[0].id
  // Если в БД несколько юзеров и не задан OBSIDIAN_SYNC_USER_ID — отказываемся
  // молча обновлять чьи-то задачи. Лучше явная ошибка, чем UPSERT не туда.
  return null
}

/** Игнорируем коммиты, сделанные самим эндпоинтом (write-back UUID), чтобы не зациклиться. */
function isWriteBackCommit(payload: GithubPushPayload): boolean {
  return payload.commits.every((c) => c.message.startsWith('tgp-sync:'))
}

export async function POST(request: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  const githubToken = process.env.GITHUB_VAULT_TOKEN
  if (!secret || !githubToken) {
    return NextResponse.json({ error: 'sync not configured' }, { status: 500 })
  }

  const body = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  if (!verifySignature(body, signature, secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const event = request.headers.get('x-github-event')
  if (event === 'ping') return NextResponse.json({ ok: true, pong: true })
  if (event !== 'push') return NextResponse.json({ ok: true, ignored: event })

  const payload = JSON.parse(body) as GithubPushPayload
  if (payload.ref !== `refs/heads/${payload.repository.default_branch}`) {
    return NextResponse.json({ ok: true, ignored: 'non-default branch' })
  }
  if (isWriteBackCommit(payload)) {
    return NextResponse.json({ ok: true, ignored: 'write-back commit' })
  }

  const userId = await resolveUserId()
  if (!userId) {
    return NextResponse.json({ error: 'cannot resolve user' }, { status: 500 })
  }

  const owner = payload.repository.owner.login
  const repo = payload.repository.name
  const branch = payload.repository.default_branch

  // Изменённые .md в Проектах. У initial push'а `before` = zero-sha;
  // в этом случае compare не работает, но обычно vault уже инициализирован,
  // и initial push — это просто документация без задач. Игнорируем.
  if (payload.before === '0000000000000000000000000000000000000000') {
    return NextResponse.json({ ok: true, ignored: 'initial push' })
  }

  const diff = await getCommitDiff({
    owner,
    repo,
    base: payload.before,
    head: payload.after,
    token: githubToken,
  })

  const targetFiles = diff.filter(
    (f) =>
      f.filename.endsWith('.md') &&
      f.filename.includes('Проекты/') &&
      f.status !== 'removed',
  )

  const summary = {
    files: targetFiles.length,
    created: 0,
    updated: 0,
    completed: 0,
    skipped: 0,
    writeBacks: 0,
  }

  for (const file of targetFiles) {
    const slug = projectSlugFromVaultPath(file.filename)
    if (!slug) {
      summary.skipped++
      continue
    }

    const fileData = await getFileContents({
      owner,
      repo,
      path: file.filename,
      ref: payload.after,
      token: githubToken,
    })
    if (!fileData) continue

    const parsed = parseObsidianTasks(fileData.content)
    const result = await syncFileTasks({
      userId,
      defaultSlug: slug,
      vaultPath: file.filename,
      tasksInFile: parsed,
    })

    summary.created += result.created
    summary.updated += result.updated
    summary.completed += result.completed
    summary.skipped += result.skipped

    // Write-back UUID для задач, которым его не было
    if (result.writeBacks.length > 0) {
      const newContent = applyWriteBacks(fileData.content, result.writeBacks)
      await putFileContents({
        owner,
        repo,
        path: file.filename,
        branch,
        message: `tgp-sync: добавил tgp:UUID в ${result.writeBacks.length} задач`,
        content: newContent,
        sha: fileData.sha,
        token: githubToken,
      })
      summary.writeBacks += result.writeBacks.length
    }
  }

  return NextResponse.json({ ok: true, summary })
}

interface WriteBack {
  lineNumber: number
  rawLine: string
  taskId: string
}

interface SyncResult {
  created: number
  updated: number
  completed: number
  skipped: number
  writeBacks: WriteBack[]
}

async function syncFileTasks(args: {
  userId: string
  defaultSlug: string
  vaultPath: string
  tasksInFile: ObsidianTask[]
}): Promise<SyncResult> {
  const result: SyncResult = {
    created: 0,
    updated: 0,
    completed: 0,
    skipped: 0,
    writeBacks: [],
  }

  // Cache проектов по slug чтобы не ходить в БД на каждой задаче
  const projectCache = new Map<string, string>()
  async function findProjectId(slug: string): Promise<string | null> {
    if (projectCache.has(slug)) return projectCache.get(slug)!
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, args.userId), eq(projects.slug, slug)))
      .limit(1)
    if (row) projectCache.set(slug, row.id)
    return row?.id ?? null
  }

  for (const t of args.tasksInFile) {
    const slug = t.projectSlug ?? args.defaultSlug
    const projectId = await findProjectId(slug)
    if (!projectId) {
      result.skipped++
      continue
    }

    const priority = t.priority ?? 'MEDIUM'
    const deadlineAt = t.due ? new Date(`${t.due}T23:59:59`) : null

    if (t.tgpId) {
      // UPSERT по id (UUID-анкер). Сначала пытаемся обновить.
      const [existing] = await db
        .select({ id: tasks.id, status: tasks.status })
        .from(tasks)
        .where(and(eq(tasks.id, t.tgpId), eq(tasks.userId, args.userId)))
        .limit(1)

      if (existing) {
        // Завершение: чекбокс отметили `[x]` в vault.
        if (t.isCompleted && existing.status !== 'DONE') {
          await db
            .update(tasks)
            .set({ status: 'DONE', completedAt: new Date() })
            .where(eq(tasks.id, existing.id))
          result.completed++
        } else {
          await db
            .update(tasks)
            .set({
              title: t.title,
              priority,
              deadlineAt,
              projectId,
              vaultPath: args.vaultPath,
            })
            .where(eq(tasks.id, existing.id))
          result.updated++
        }
      } else {
        // Анкер есть, но в БД задачи нет — создаём с этим id (так
        // повторный push не создаст дубликат до новой записи).
        await db.insert(tasks).values({
          id: t.tgpId,
          userId: args.userId,
          projectId,
          title: t.title,
          priority,
          deadlineAt,
          status: t.isCompleted ? 'DONE' : 'TODO',
          completedAt: t.isCompleted ? new Date() : null,
          vaultPath: args.vaultPath,
        })
        result.created++
      }
    } else {
      // Анкера нет — это новая задача. Создаём с автогенерированным UUID,
      // запоминаем для write-back.
      const newId = crypto.randomUUID()
      await db.insert(tasks).values({
        id: newId,
        userId: args.userId,
        projectId,
        title: t.title,
        priority,
        deadlineAt,
        status: t.isCompleted ? 'DONE' : 'TODO',
        completedAt: t.isCompleted ? new Date() : null,
        vaultPath: args.vaultPath,
      })
      result.created++
      result.writeBacks.push({
        lineNumber: t.lineNumber,
        rawLine: t.raw,
        taskId: newId,
      })
    }
  }

  // Деструктивная синхронизация (удалили в vault → удалили в БД) отложена:
  // в первой версии её делать опасно — если пользователь временно вырежет
  // секцию задач из заметки, все задачи к ней превратятся в ARCHIVED.
  // Сначала однонаправленное «vault создаёт/обновляет», потом, когда поймём
  // паттерны использования, добавим управляемое удаление.

  return result
}

/** Добавляет анкер `<!--tgp:UUID-->` в конец каждой write-back строки. */
function applyWriteBacks(markdown: string, writeBacks: WriteBack[]): string {
  const lines = markdown.split('\n')
  for (const wb of writeBacks) {
    // lineNumber 1-based, массив 0-based
    const idx = wb.lineNumber - 1
    if (lines[idx] === wb.rawLine) {
      lines[idx] = `${wb.rawLine.trimEnd()} <!--tgp:${wb.taskId}-->`
    }
  }
  return lines.join('\n')
}
