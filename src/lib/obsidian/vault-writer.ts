/**
 * Публикация изменений задачи из tg-planer обратно в vault (GitHub commit).
 *
 * Ожидаемое поведение — fire-and-forget: если GitHub недоступен или анкера
 * в файле нет, локальный PATCH задачи всё равно должен пройти. Ошибка
 * пишется в console.warn, чтобы её видно было в логах Vercel.
 *
 * Env, которые должны быть заданы (иначе no-op):
 *   GITHUB_VAULT_TOKEN   — PAT с правом repo
 *   VAULT_REPO_OWNER     — обычно ssopplus (см. docs/obsidian-sync.md)
 *   VAULT_REPO_NAME      — obsidian-docs
 *   VAULT_REPO_BRANCH    — main (по умолчанию)
 */

import { getFileContents, putFileContents } from '@/lib/github/client'
import { applyTaskWriteBack, type TaskWriteBackUpdates } from './write-back'

export interface WriteBackTaskArgs {
  vaultPath: string
  taskUuid: string
  updates: TaskWriteBackUpdates
  /** Часть текста задачи для человекочитаемого commit-message. */
  taskTitle?: string
}

interface VaultRepoConfig {
  owner: string
  repo: string
  branch: string
  token: string
}

function resolveVaultRepo(): VaultRepoConfig | null {
  const token = process.env.GITHUB_VAULT_TOKEN
  const owner = process.env.VAULT_REPO_OWNER
  const repo = process.env.VAULT_REPO_NAME
  const branch = process.env.VAULT_REPO_BRANCH ?? 'main'
  if (!token || !owner || !repo) return null
  return { token, owner, repo, branch }
}

export async function writeBackTaskToVault(
  args: WriteBackTaskArgs,
): Promise<{ ok: boolean; reason?: string }> {
  const repo = resolveVaultRepo()
  if (!repo) return { ok: false, reason: 'vault repo env not configured' }

  const file = await getFileContents({
    owner: repo.owner,
    repo: repo.repo,
    path: args.vaultPath,
    ref: repo.branch,
    token: repo.token,
  })
  if (!file) return { ok: false, reason: `vault file not found: ${args.vaultPath}` }

  const newContent = applyTaskWriteBack(file.content, args.taskUuid, args.updates)
  if (newContent === null) {
    return { ok: false, reason: 'anchor not found or no changes' }
  }

  const title = args.taskTitle ? args.taskTitle.slice(0, 60) : args.taskUuid.slice(0, 8)
  await putFileContents({
    owner: repo.owner,
    repo: repo.repo,
    path: args.vaultPath,
    branch: repo.branch,
    message: `tgp-sync: обновил задачу «${title}»`,
    content: newContent,
    sha: file.sha,
    token: repo.token,
  })
  return { ok: true }
}
