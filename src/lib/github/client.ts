/**
 * Минимальный клиент GitHub REST API для нужд /api/sync/obsidian.
 * Octokit не используем: нам нужно три операции, fetch-обёртка проще.
 *
 * Auth: PAT (Personal Access Token) с правом `repo` (для private vault-репо).
 * Хранится в env GITHUB_VAULT_TOKEN.
 */

const BASE = 'https://api.github.com'

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/** Получить содержимое файла на конкретном ref. Возвращает текст и SHA blob'а. */
export async function getFileContents(args: {
  owner: string
  repo: string
  path: string
  ref: string
  token: string
}): Promise<{ content: string; sha: string } | null> {
  const url = `${BASE}/repos/${args.owner}/${args.repo}/contents/${encodeURIComponent(args.path)}?ref=${encodeURIComponent(args.ref)}`
  const res = await fetch(url, { headers: authHeaders(args.token) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { content: string; encoding: string; sha: string }
  if (data.encoding !== 'base64') throw new Error(`Unexpected encoding ${data.encoding}`)
  return {
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
    sha: data.sha,
  }
}

/** Записать файл (создаёт коммит). Если sha указан — обновляет существующий. */
export async function putFileContents(args: {
  owner: string
  repo: string
  path: string
  branch: string
  message: string
  content: string
  sha?: string
  token: string
}): Promise<void> {
  const url = `${BASE}/repos/${args.owner}/${args.repo}/contents/${encodeURIComponent(args.path)}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...authHeaders(args.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: args.message,
      content: Buffer.from(args.content, 'utf-8').toString('base64'),
      branch: args.branch,
      ...(args.sha ? { sha: args.sha } : {}),
    }),
  })
  if (!res.ok) throw new Error(`GitHub PUT ${res.status}: ${await res.text()}`)
}

/**
 * Сравнивает два коммита и возвращает список изменённых файлов.
 * `before` и `after` — SHA коммитов (приходят в payload webhook'а).
 */
export async function getCommitDiff(args: {
  owner: string
  repo: string
  base: string
  head: string
  token: string
}): Promise<Array<{ filename: string; status: string }>> {
  const url = `${BASE}/repos/${args.owner}/${args.repo}/compare/${args.base}...${args.head}`
  const res = await fetch(url, { headers: authHeaders(args.token) })
  if (!res.ok) throw new Error(`GitHub compare ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { files?: Array<{ filename: string; status: string }> }
  return data.files ?? []
}
