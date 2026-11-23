import { getCloudflareContext } from '@opennextjs/cloudflare'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

type Db = ReturnType<typeof connect>

function connect(url: string, opts: postgres.Options<Record<string, never>> = {}) {
  return drizzle(postgres(url, opts), { schema })
}

/** Контекст запроса Cloudflare Workers или null вне Workers (next dev, скрипты, тесты). */
function workerCtx(): object | null {
  try {
    return getCloudflareContext().ctx ?? null
  } catch {
    return null
  }
}

/** На Workers сокет нельзя переиспользовать в другом запросе, поэтому подключение своё на каждый запрос. */
const perRequest = new WeakMap<object, Db>()
let shared: Db | null = null

function current(): Db {
  const url = process.env.DATABASE_URL!
  const ctx = workerCtx()
  if (!ctx) return (shared ??= connect(url))
  let db = perRequest.get(ctx)
  if (!db) {
    // max 1: одно соединение на запрос; prepare false — пулер Supabase в режиме транзакций их не держит.
    db = connect(url, { max: 1, prepare: false, fetch_types: false })
    perRequest.set(ctx, db)
  }
  return db
}

/**
 * Прокси вместо подключения: модули держат `db` весь срок изолята, а каждое обращение
 * уходит в подключение текущего запроса.
 */
export const db = new Proxy({} as Db, {
  get(_t, prop) {
    const d = current()
    const v = Reflect.get(d, prop, d)
    return typeof v === 'function' ? v.bind(d) : v
  },
})
