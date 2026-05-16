'use client'

/**
 * Очередь отложенных мутаций для оффлайн-режима.
 *
 * Когда `mutateSafely()` не смог достучаться до сервера после retry,
 * запрос складывается сюда. При появлении сети (`window: online`)
 * `flushOutbox()` пытается отправить накопленное.
 *
 * Хранится в localStorage по ключу `tgp.outbox`, чтобы пережить
 * перезагрузку страницы или закрытие Mini App.
 */

const STORAGE_KEY = 'tgp.outbox'

export interface OutboxEntry {
  id: string
  method: 'POST' | 'PATCH' | 'DELETE' | 'PUT'
  url: string
  body?: string
  /** Описание для пользователя: "Создание задачи", "Изменение статуса" и т.д. */
  label: string
  createdAt: number
  attempts: number
}

type Listener = (entries: OutboxEntry[]) => void
const listeners = new Set<Listener>()

function read(): OutboxEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : []
  } catch {
    return []
  }
}

function write(entries: OutboxEntry[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Quota exceeded — игнорируем, лучше потерять, чем сломать UI
  }
  for (const l of listeners) l(entries)
}

export function getOutbox(): OutboxEntry[] {
  return read()
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener)
  listener(read())
  return () => {
    listeners.delete(listener)
  }
}

export function pushToOutbox(entry: Omit<OutboxEntry, 'id' | 'createdAt' | 'attempts'>): OutboxEntry {
  const full: OutboxEntry = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    attempts: 0,
  }
  const next = [...read(), full]
  write(next)
  return full
}

export function removeFromOutbox(id: string): void {
  write(read().filter((e) => e.id !== id))
}

export function updateOutboxEntry(id: string, patch: Partial<OutboxEntry>): void {
  write(read().map((e) => (e.id === id ? { ...e, ...patch } : e)))
}

export function clearOutbox(): void {
  write([])
}
