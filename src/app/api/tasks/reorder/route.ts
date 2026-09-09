import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks } from '@/lib/db/schema'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { computeSlotReorder } from '@/lib/tasks/reorder'

/**
 * PATCH /api/tasks/reorder — ручное ранжирование задач перетаскиванием.
 *
 * Тело: `{ ids: string[] }` — новый порядок ВИДИМЫХ задач (одного раздела:
 * «Трекер», «Внутренние» или «Все»).
 *
 * Порядок хранится глобально в `tasks.sort_order`, а разделы — это фильтр
 * поверх него. Поэтому перетаскивание внутри раздела не должно двигать
 * задачи, которых в нём не видно. Решение — «слоты»: позиции, которые
 * занимали видимые задачи в глобальном списке, переприсваиваются им же
 * в новом порядке, а позиции скрытых остаются нетронутыми.
 *
 * Пример: видимые заняли слоты 1, 4, 7. После перетаскивания они получают
 * те же 1, 4, 7 — но в новом порядке. Скрытые (0, 2, 3, 5, 6) не сдвигаются.
 *
 * Первый вызов дополнительно нормализует порядок: пока ранжирования не было,
 * у всех задач `sort_order = 0`, и слоты пришлось бы делить между всеми.
 * Нормализация раскладывает текущую выдачу в 0..N-1 (по sort_order, затем по
 * created_at — тот же ключ, что у `sort=manual` в GET /api/tasks).
 */
export async function PATCH(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { ids } = body as { ids?: unknown }

  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'ids должен быть массивом строк' }, { status: 400 })
  }
  const orderedIds = ids as string[]
  if (orderedIds.length === 0) return NextResponse.json({ ok: true, updated: 0 })

  // Ранжируем только незакрытые задачи: выполненные и архивные живут в архиве,
  // тащить их через слоты незачем.
  const all = await db
    .select({ id: tasks.id, sortOrder: tasks.sortOrder })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, user.id),
        inArray(tasks.status, ['TODO', 'IN_PROGRESS']),
      ),
    )
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))

  const { changes, unknownIds } = computeSlotReorder(all, orderedIds)

  // Пришли id, которых нет среди активных задач пользователя (чужие,
  // удалённые или уже завершённые) — порядок неполный, применять нельзя.
  if (unknownIds.length > 0) {
    return NextResponse.json(
      { error: 'часть задач не найдена среди активных задач пользователя', unknownIds },
      { status: 400 },
    )
  }
  if (changes.length === 0) return NextResponse.json({ ok: true, updated: 0 })

  // Один UPDATE ... FROM (VALUES ...) вместо цикла запросов: на serverless
  // через пулер каждый round-trip дорогой, а строк тут может быть сотня.
  const values = sql.join(
    changes.map(({ id, pos }) => sql`(${id}, ${pos})`),
    sql`, `,
  )
  await db.execute(sql`
    UPDATE ${tasks} SET sort_order = v.pos::int
    FROM (VALUES ${values}) AS v(id, pos)
    WHERE ${tasks.id} = v.id AND ${tasks.userId} = ${user.id}
  `)

  return NextResponse.json({ ok: true, updated: changes.length })
}
