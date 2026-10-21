import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { cockpitRequests, users } from '@/lib/db/schema'

/**
 * Запросы сессий Claude Code, присланные локальным dev-cockpit.
 *
 * Здесь только данные: решение пользователя ложится в строку, cockpit
 * забирает его следующим синком и отдаёт хуку сессии. Сообщения бота — в
 * src/bot/services/cockpit-notify.ts.
 */

export type CockpitRequest = typeof cockpitRequests.$inferSelect
export type CockpitDecision = NonNullable<CockpitRequest['decision']>

/** Вопрос `AskUserQuestion` в том виде, в каком его присылает Claude. */
export interface CockpitQuestion {
  question: string
  header?: string
  multiSelect?: boolean
  options: { label: string; description?: string }[]
}

export function questionsOf(req: Pick<CockpitRequest, 'payload'>): CockpitQuestion[] {
  const qs = (req.payload as { questions?: unknown }).questions
  return Array.isArray(qs) ? (qs as CockpitQuestion[]) : []
}

/**
 * Пользователь, к которому привязан cockpit. Single-user, как синк Трекера:
 * `COCKPIT_USER_ID`, затем `TRACKER_SYNC_USER_ID`, затем единственный в БД.
 */
export async function resolveCockpitUser(): Promise<{ id: string; telegramId: bigint } | null> {
  const fromEnv = process.env.COCKPIT_USER_ID ?? process.env.TRACKER_SYNC_USER_ID
  const cols = { id: users.id, telegramId: users.telegramId }
  if (fromEnv) {
    const [row] = await db.select(cols).from(users).where(eq(users.id, fromEnv)).limit(1)
    return row ?? null
  }
  const all = await db.select(cols).from(users).limit(2)
  return all.length === 1 ? all[0] : null
}

export async function getRequest(userId: string, id: string): Promise<CockpitRequest | null> {
  const [req] = await db
    .select()
    .from(cockpitRequests)
    .where(and(eq(cockpitRequests.id, id), eq(cockpitRequests.userId, userId)))
    .limit(1)
  return req ?? null
}

/** Решение из Telegram или Mini App. Для вопроса — ответы целиком или по одному. */
export type DecisionInput =
  | { behavior: 'allow'; always?: boolean }
  | { behavior: 'deny'; message?: string }
  | { answers: Record<string, string> }

export type DecisionResult =
  | { ok: true; req: CockpitRequest; complete: boolean }
  | { ok: false; error: string; req?: CockpitRequest }

/**
 * Записывает решение, если запрос ещё ждёт ответа.
 *
 * Вопросов в одном `AskUserQuestion` бывает несколько, а бот спрашивает их
 * по одному: ответы копятся в `decision.answers`, запрос остаётся pending,
 * пока не отвечены все. Защита от гонки — условие `status = 'pending'` в
 * самом UPDATE: второй ответ (из другого клиента) просто не найдёт строку.
 */
export async function applyDecision(
  userId: string,
  id: string,
  input: DecisionInput,
): Promise<DecisionResult> {
  const req = await getRequest(userId, id)
  if (!req) return { ok: false, error: 'Запрос не найден' }
  if (req.status !== 'pending') return { ok: false, error: 'Запрос уже закрыт', req }

  let decision: CockpitDecision
  let complete = true
  if ('answers' in input) {
    if (req.kind !== 'question') return { ok: false, error: 'Это не вопрос', req }
    const answers = { ...(req.decision?.answers ?? {}), ...input.answers }
    decision = { behavior: 'allow', answers }
    complete = questionsOf(req).every((q) => answers[q.question] !== undefined)
  } else if (input.behavior === 'deny') {
    decision = { behavior: 'deny', message: input.message?.slice(0, 2000) || 'Отклонено в Telegram' }
  } else {
    if (req.kind === 'question') return { ok: false, error: 'Выбери вариант ответа', req }
    decision = { behavior: 'allow', ...(input.always && req.canAlways ? { always: true } : {}) }
  }

  const [updated] = await db
    .update(cockpitRequests)
    .set(complete ? { decision, status: 'answered', answeredAt: new Date() } : { decision })
    .where(and(eq(cockpitRequests.id, id), eq(cockpitRequests.status, 'pending')))
    .returning()
  if (!updated) return { ok: false, error: 'Запрос уже закрыт', req }
  return { ok: true, req: updated, complete }
}
