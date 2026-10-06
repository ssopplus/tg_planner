'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { apiFetch, hapticImpact } from '@/lib/telegram/webapp'
import { showToast } from '@/lib/api/toast'
import { toDayString } from '@/lib/boards/due-dates'

interface NoteTask {
  id: string
  title: string
  body: string | null
  dueDate: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'ARCHIVED'
  boardId: string | null
  createdAt: string
}

interface Board {
  id: string
  name: string
  emoji: string | null
}

const PRIORITIES: Array<{ id: NoteTask['priority']; label: string }> = [
  { id: 'HIGH', label: 'Важно' },
  { id: 'MEDIUM', label: 'Обычное' },
  { id: 'LOW', label: 'Потом' },
]

/**
 * Личное дело — заметка с чекбоксом.
 *
 * Основное место занимает свободный текст: адреса, телефоны, размеры,
 * подпункты. Доска, срок и важность — атрибуты сверху, они нужны реже, чем
 * сам текст, поэтому не занимают экран.
 */
export default function NotePage() {
  const params = useParams()
  const router = useRouter()
  const taskId = params.id as string
  const today = useMemo(() => toDayString(new Date()), [])

  const [task, setTask] = useState<NoteTask | null>(null)
  const [boards, setBoards] = useState<Board[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [showBoards, setShowBoards] = useState(false)
  const [showPriority, setShowPriority] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/tasks/${taskId}`)
      if (res.ok) {
        const data = (await res.json()) as NoteTask
        setTask(data)
        setTitle(data.title)
        setBody(data.body ?? '')
      }
    } finally {
      setLoading(false)
    }
  }, [taskId])

  const loadBoards = useCallback(
    () =>
      apiFetch('/api/boards').then(async (res) => {
        if (res.ok) setBoards((await res.json()) as Board[])
      }),
    [],
  )

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadBoards()
  }, [loadBoards])

  const patch = useCallback(
    async (data: Record<string, unknown>) => {
      const res = await apiFetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      })
      if (!res.ok) showToast({ kind: 'error', message: 'Изменение не сохранилось' })
      return res.ok
    },
    [taskId],
  )

  if (loading) {
    return (
      <p className="px-4 py-10 text-center text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">
        Загружаю…
      </p>
    )
  }

  if (!task) {
    return (
      <p className="px-4 py-10 text-center text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">
        Дело не найдено.
      </p>
    )
  }

  const board = boards.find((b) => b.id === task.boardId)
  const done = task.status === 'DONE'

  return (
    <div className="flex flex-col gap-3 px-4 pt-3">
      <button
        type="button"
        onClick={() => router.back()}
        className="flex w-fit items-center gap-1 text-[14px] text-[var(--tg-theme-link-color,#007aff)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Назад
      </button>

      <div className="flex items-start gap-2.5">
        <button
          type="button"
          aria-label={done ? 'Вернуть в работу' : 'Отметить выполненным'}
          onClick={() => {
            hapticImpact('light')
            const next = done ? 'TODO' : 'DONE'
            setTask({ ...task, status: next })
            patch({ status: next })
          }}
          className={`mt-1 h-[22px] w-[22px] shrink-0 rounded-md border-2 ${
            done
              ? 'border-[var(--tg-theme-button-color,#007aff)] bg-[var(--tg-theme-button-color,#007aff)]'
              : 'border-[var(--tg-theme-hint-color,#8e8e93)]'
          }`}
        />
        <input
          id="note-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const value = title.trim()
            if (value && value !== task.title) patch({ title: value })
          }}
          className={`min-w-0 flex-1 bg-transparent text-[19px] font-bold leading-snug text-[var(--tg-theme-text-color,#000)] outline-none ${
            done ? 'line-through opacity-60' : ''
          }`}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setShowBoards((v) => !v)}
          className="rounded-lg border border-border bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-3 py-1.5 text-[13px] font-medium text-[var(--tg-theme-text-color,#000)]"
        >
          {board ? `${board.emoji ?? ''} ${board.name}`.trim() : 'Без доски'} ▾
        </button>

        <input
          id="note-due"
          type="date"
          value={task.dueDate ?? ''}
          onChange={(e) => {
            const value = e.target.value || null
            setTask({ ...task, dueDate: value })
            patch({ dueDate: value })
          }}
          className="rounded-lg border border-border bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-3 py-1.5 text-[13px] font-medium text-[var(--tg-theme-text-color,#000)]"
        />

        <button
          type="button"
          onClick={() => setShowPriority((v) => !v)}
          className="rounded-lg border border-border bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-3 py-1.5 text-[13px] font-medium text-[var(--tg-theme-text-color,#000)]"
        >
          {PRIORITIES.find((p) => p.id === task.priority)?.label} ▾
        </button>
      </div>

      {showBoards ? (
        <div className="flex flex-wrap gap-1.5">
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setTask({ ...task, boardId: b.id })
                setShowBoards(false)
                patch({ boardId: b.id })
              }}
              className={`rounded-lg px-3 py-1.5 text-[13px] ${
                b.id === task.boardId
                  ? 'bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)]'
                  : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-text-color,#000)]'
              }`}
            >
              {b.emoji ? `${b.emoji} ` : ''}
              {b.name}
            </button>
          ))}
        </div>
      ) : null}

      {showPriority ? (
        <div className="flex gap-1.5">
          {PRIORITIES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setTask({ ...task, priority: p.id })
                setShowPriority(false)
                patch({ priority: p.id })
              }}
              className={`flex-1 rounded-lg py-1.5 text-[13px] ${
                p.id === task.priority
                  ? 'bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)]'
                  : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-text-color,#000)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : null}

      <textarea
        id="note-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => {
          if (body !== (task.body ?? '')) patch({ body })
        }}
        rows={10}
        placeholder="Адреса, телефоны, размеры, подпункты — всё, что пригодится, когда дойдут руки"
        className="w-full resize-y rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-3 text-[14px] leading-relaxed text-[var(--tg-theme-text-color,#000)] outline-none"
      />

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--tg-theme-hint-color,#8e8e93)]">
          Заведено{' '}
          {new Date(task.createdAt).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'short',
          })}
          {task.dueDate === today ? ' · срок сегодня' : ''}
        </span>
        <button
          type="button"
          onClick={async () => {
            hapticImpact('rigid')
            const res = await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
            if (res.ok) router.back()
            else showToast({ kind: 'error', message: 'Не удалось удалить' })
          }}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-[var(--tg-theme-destructive-text-color,#d1453b)]"
        >
          <Trash2 className="h-4 w-4" />
          Удалить
        </button>
      </div>
    </div>
  )
}
