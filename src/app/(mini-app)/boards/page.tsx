'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { apiFetch } from '@/lib/telegram/webapp'
import { showToast } from '@/lib/api/toast'
import { TabStrip } from '@/components/ui/tab-strip'
import { DueBoard, type BoardTask } from '@/components/boards/due-board'
import { dueForColumn, toDayString, type DueColumn } from '@/lib/boards/due-dates'

interface Board {
  id: string
  name: string
  emoji: string | null
  isInbox: boolean
  taskCount: number
}

export default function BoardsPage() {
  const [boards, setBoards] = useState<Board[]>([])
  const [activeBoard, setActiveBoard] = useState<string>('')
  const [tasks, setTasks] = useState<BoardTask[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [creatingBoard, setCreatingBoard] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')

  const today = useMemo(() => toDayString(new Date()), [])

  const loadBoards = useCallback(async () => {
    try {
      const res = await apiFetch('/api/boards')
      if (!res.ok) return
      const rows = (await res.json()) as Board[]
      setBoards(rows)
      setActiveBoard((current) => current || rows[0]?.id || '')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadTasks = useCallback(
    (boardId: string) =>
      apiFetch(`/api/tasks?board_id=${boardId}&status=TODO,IN_PROGRESS,DONE&limit=200`).then(
        async (res) => {
          if (res.ok) setTasks((await res.json()) as BoardTask[])
        },
      ),
    [],
  )

  useEffect(() => {
    loadBoards()
  }, [loadBoards])

  useEffect(() => {
    if (activeBoard) loadTasks(activeBoard)
  }, [activeBoard, loadTasks])

  /** Перенос карточки между колонками = простановка срока. */
  async function move(taskId: string, column: DueColumn) {
    const dueDate = dueForColumn(column, today)
    // Оптимистично: доска должна отзываться сразу, запрос догонит.
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, dueDate } : t)))

    const res = await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ dueDate }),
    })
    if (!res.ok) {
      showToast({ kind: 'error', message: 'Срок не сохранился' })
      loadTasks(activeBoard)
    }
  }

  async function toggle(taskId: string, done: boolean) {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: done ? 'DONE' : 'TODO' } : t)),
    )
    const res = await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: done ? 'DONE' : 'TODO' }),
    })
    if (!res.ok) loadTasks(activeBoard)
  }

  async function addTask() {
    const title = draft.trim()
    if (!title) return
    setDraft('')

    const res = await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, boardId: activeBoard }),
    })
    if (res.ok) {
      loadTasks(activeBoard)
    } else {
      showToast({ kind: 'error', message: 'Дело не записалось' })
      setDraft(title)
    }
  }

  async function addBoard() {
    const name = newBoardName.trim()
    if (!name) return

    const res = await apiFetch('/api/boards', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      const board = (await res.json()) as Board
      setNewBoardName('')
      setCreatingBoard(false)
      await loadBoards()
      setActiveBoard(board.id)
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      showToast({ kind: 'error', message: err.error ?? 'Доска не создалась' })
    }
  }

  if (loading) {
    return (
      <p className="px-4 py-10 text-center text-sm text-[var(--tg-theme-hint-color,#8e8e93)]">
        Загружаю доски…
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3 pt-4">
      <h1 className="px-4 text-xl font-bold text-[var(--tg-theme-text-color,#000)]">Личное</h1>

      <TabStrip
        items={boards.map((b) => ({
          id: b.id,
          label: b.name,
          emoji: b.emoji,
          count: b.taskCount,
        }))}
        activeId={activeBoard}
        onSelect={setActiveBoard}
        action={{ label: 'Новая доска', onClick: () => setCreatingBoard((v) => !v) }}
      />

      {creatingBoard ? (
        <div className="flex gap-2 px-4">
          <input
            id="new-board-name"
            value={newBoardName}
            onChange={(e) => setNewBoardName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addBoard()
            }}
            placeholder="Название доски, например «Машина»"
            className="min-w-0 flex-1 rounded-lg border border-border bg-[var(--tg-theme-bg-color,#fff)] px-3 py-2 text-[15px] text-[var(--tg-theme-text-color,#000)]"
          />
          <button
            type="button"
            onClick={addBoard}
            className="rounded-lg bg-[var(--tg-theme-button-color,#007aff)] px-4 py-2 text-[14px] font-semibold text-[var(--tg-theme-button-text-color,#fff)]"
          >
            Создать
          </button>
        </div>
      ) : null}

      <DueBoard tasks={tasks} today={today} onMove={move} onToggle={toggle} />

      <div className="flex gap-2 px-4">
        <input
          id="quick-note"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTask()
          }}
          placeholder="Быстрая запись"
          className="min-w-0 flex-1 rounded-lg border border-border bg-[var(--tg-theme-bg-color,#fff)] px-3 py-2.5 text-[15px] text-[var(--tg-theme-text-color,#000)]"
        />
        <button
          type="button"
          onClick={addTask}
          disabled={!draft.trim()}
          aria-label="Добавить дело"
          className="rounded-lg bg-[var(--tg-theme-button-color,#007aff)] px-4 text-[var(--tg-theme-button-text-color,#fff)] disabled:opacity-40"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
