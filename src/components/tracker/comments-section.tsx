'use client'

import { useCallback, useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { apiFetch } from '@/lib/telegram/webapp'
import { showToast } from '@/lib/api/toast'

interface Comment {
  id: number
  text: string
  author: string
  createdAt: string
}

/** Обсуждение задачи: читаем ленту и отвечаем, не уходя в браузер. */
export function CommentsSection({ issueKey }: { issueKey: string }) {
  const [comments, setComments] = useState<Comment[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/tracker/issues/${issueKey}/comments`)
      if (res.ok) setComments((await res.json()) as Comment[])
    } finally {
      setLoading(false)
    }
  }, [issueKey])

  useEffect(() => {
    load()
  }, [load])

  async function send() {
    const value = text.trim()
    if (!value || sending) return
    setSending(true)

    const res = await apiFetch(`/api/tracker/issues/${issueKey}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text: value }),
    })

    if (res.ok) {
      const created = (await res.json()) as Comment
      setComments((prev) => [...prev, created])
      setText('')
    } else {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      showToast({ kind: 'error', message: data.error ?? 'Комментарий не ушёл' })
    }
    setSending(false)
  }

  return (
    <section className="rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-3">
      <h2 className="text-[13px] font-semibold text-[var(--tg-theme-text-color,#000)]">
        Комментарии{comments.length ? ` · ${comments.length}` : ''}
      </h2>

      {loading ? (
        <p className="mt-2 text-[13px] text-[var(--tg-theme-hint-color,#8e8e93)]">Загружаю…</p>
      ) : comments.length === 0 ? (
        <p className="mt-2 text-[13px] text-[var(--tg-theme-hint-color,#8e8e93)]">
          Обсуждения пока нет.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2.5">
          {comments.map((comment) => (
            <li key={comment.id} className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] font-semibold text-[var(--tg-theme-text-color,#000)]">
                  {comment.author}
                </span>
                <span className="text-[11px] text-[var(--tg-theme-hint-color,#8e8e93)]">
                  {new Date(comment.createdAt).toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-[var(--tg-theme-text-color,#000)]">
                {comment.text}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <input
          id={`comment-input-${issueKey}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Написать в задачу"
          className="min-w-0 flex-1 rounded-lg border border-border bg-[var(--tg-theme-bg-color,#fff)] px-3 py-2 text-[14px] text-[var(--tg-theme-text-color,#000)]"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          aria-label="Отправить комментарий"
          className="rounded-lg bg-[var(--tg-theme-button-color,#007aff)] px-3 py-2 text-[var(--tg-theme-button-text-color,#fff)] disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </section>
  )
}
