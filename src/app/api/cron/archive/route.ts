import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tasks } from '@/lib/db/schema'
import { and, eq, lte, sql } from 'drizzle-orm'

/**
 * Cron endpoint для автоархивации завершённых задач.
 * Задачи со статусом DONE, завершённые более 7 дней назад → ARCHIVED.
 * Vercel Cron: раз в день в 03:00.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const result = await db
    .update(tasks)
    .set({ status: 'ARCHIVED' })
    .where(
      and(
        eq(tasks.status, 'DONE'),
        lte(tasks.completedAt, sevenDaysAgo),
      ),
    )
    .returning({ id: tasks.id })

  return NextResponse.json({
    ok: true,
    archived: result.length,
  })
}
