import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { coordinationPolls } from '@/lib/db/schema'
import { findAwaitingTitle, updatePendingTask } from './pending-store'

/**
 * Сброс незавершённых диалогов пользователя.
 *
 * У бота несколько пошаговых сценариев, и каждый держит своё ожидание:
 * координация ждёт текст комментария, черновик дела — новое название. Пока
 * сброса не было, нажатие другой кнопки оставляло предыдущий сценарий
 * висеть, и следующее сообщение уезжало не туда — человек нажимал
 * «Координация», а его текст уходил в комментарий к списанию.
 *
 * Вызывается в начале любого быстрого действия: новое намерение отменяет
 * старое, и это честнее, чем молча копить ожидания.
 */
export async function cancelActiveFlows(userId: string): Promise<void> {
  await db
    .update(coordinationPolls)
    .set({ pendingInput: null })
    .where(and(eq(coordinationPolls.userId, userId), isNotNull(coordinationPolls.pendingInput)))

  const awaiting = await findAwaitingTitle(userId)
  if (awaiting) await updatePendingTask(awaiting.id, { awaitingTitle: false })
}
