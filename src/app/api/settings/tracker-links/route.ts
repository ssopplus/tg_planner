import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { projects, trackerQueueLinks } from '@/lib/db/schema'
import { and, asc, eq, ne } from 'drizzle-orm'
import { authorizeMiniApp } from '@/lib/telegram/auth'

/**
 * Связки «очередь Яндекс.Трекера → проект» — единственный источник истины
 * о том, куда синк раскладывает тикеты (см. src/lib/db/schema.ts).
 *
 * GET    — список связок с именами проектов.
 * POST   — создать связку { queueKey, projectId, titleFilter?, isDefaultForProject? }.
 * PATCH  — изменить связку { id, ... }.
 * DELETE — удалить связку (?id=).
 */

/** Приводит фильтр к хранимому виду: пустая строка равнозначна «нет фильтра». */
function normalizeFilter(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Проверяет, что проект существует и принадлежит пользователю. */
async function assertOwnProject(userId: string, projectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)
  return Boolean(row)
}

/**
 * Снимает признак «очередь по умолчанию» с остальных связок проекта:
 * при «поднятии» задачи в Трекер предлагается ровно одна очередь.
 */
async function clearOtherDefaults(userId: string, projectId: string, keepId: string) {
  await db
    .update(trackerQueueLinks)
    .set({ isDefaultForProject: false })
    .where(
      and(
        eq(trackerQueueLinks.userId, userId),
        eq(trackerQueueLinks.projectId, projectId),
        ne(trackerQueueLinks.id, keepId),
      ),
    )
}

/** Отличает нарушение уникальности от прочих сбоев БД. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

export async function GET(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await db
    .select({
      id: trackerQueueLinks.id,
      queueKey: trackerQueueLinks.queueKey,
      projectId: trackerQueueLinks.projectId,
      projectName: projects.name,
      titleFilter: trackerQueueLinks.titleFilter,
      isDefaultForProject: trackerQueueLinks.isDefaultForProject,
    })
    .from(trackerQueueLinks)
    .innerJoin(projects, eq(projects.id, trackerQueueLinks.projectId))
    .where(eq(trackerQueueLinks.userId, user.id))
    .orderBy(asc(trackerQueueLinks.queueKey), asc(trackerQueueLinks.createdAt))

  return NextResponse.json(rows)
}

export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const queueKey = typeof body.queueKey === 'string' ? body.queueKey.trim().toUpperCase() : ''
  const projectId = typeof body.projectId === 'string' ? body.projectId : ''

  if (!queueKey || !projectId) {
    return NextResponse.json({ error: 'queueKey и projectId обязательны' }, { status: 400 })
  }
  if (!(await assertOwnProject(user.id, projectId))) {
    return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }

  try {
    const [created] = await db
      .insert(trackerQueueLinks)
      .values({
        userId: user.id,
        queueKey,
        projectId,
        titleFilter: normalizeFilter(body.titleFilter),
        isDefaultForProject: body.isDefaultForProject === true,
      })
      .returning()

    if (created.isDefaultForProject) {
      await clearOtherDefaults(user.id, projectId, created.id)
    }
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        {
          error: normalizeFilter(body.titleFilter)
            ? `У очереди ${queueKey} уже есть связка с таким фильтром`
            : `У очереди ${queueKey} уже есть основная связка — задайте фильтр по заголовку`,
        },
        { status: 409 },
      )
    }
    throw error
  }
}

export async function PATCH(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (body.queueKey !== undefined) updates.queueKey = String(body.queueKey).trim().toUpperCase()
  if (body.titleFilter !== undefined) updates.titleFilter = normalizeFilter(body.titleFilter)
  if (body.isDefaultForProject !== undefined) {
    updates.isDefaultForProject = body.isDefaultForProject === true
  }
  if (body.projectId !== undefined) {
    if (!(await assertOwnProject(user.id, String(body.projectId)))) {
      return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
    }
    updates.projectId = body.projectId
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'нечего обновлять' }, { status: 400 })
  }

  try {
    const [updated] = await db
      .update(trackerQueueLinks)
      .set(updates)
      .where(and(eq(trackerQueueLinks.id, id), eq(trackerQueueLinks.userId, user.id)))
      .returning()

    if (!updated) return NextResponse.json({ error: 'Связка не найдена' }, { status: 404 })
    if (updated.isDefaultForProject) {
      await clearOtherDefaults(user.id, updated.projectId, updated.id)
    }
    return NextResponse.json(updated)
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'Такая связка уже есть' }, { status: 409 })
    }
    throw error
  }
}

export async function DELETE(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

  const [deleted] = await db
    .delete(trackerQueueLinks)
    .where(and(eq(trackerQueueLinks.id, id), eq(trackerQueueLinks.userId, user.id)))
    .returning({ id: trackerQueueLinks.id })

  if (!deleted) return NextResponse.json({ error: 'Связка не найдена' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
