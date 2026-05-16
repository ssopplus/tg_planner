'use client'

import { apiFetch } from '@/lib/telegram/webapp'
import { pushToOutbox, removeFromOutbox, updateOutboxEntry, type OutboxEntry } from './outbox'
import { showToast } from './toast'

interface MutateOptions {
  /** HTTP-метод мутации */
  method: 'POST' | 'PATCH' | 'DELETE' | 'PUT'
  /** URL эндпоинта */
  url: string
  /** Тело запроса (будет JSON.stringify-нуто) */
  body?: unknown
  /** Описание для пользователя: «Изменение статуса», «Удаление задачи» */
  label: string
  /** Колбэк, который вызывается при окончательной неудаче (после всех retry). */
  onRollback?: () => void
  /** Сколько ретраев делать (по умолчанию 3) */
  maxRetries?: number
}

const DEFAULT_RETRIES = 3
const BACKOFF_MS = [250, 500, 1000]

/**
 * Делает мутацию с экспоненциальным backoff retry.
 * Если интернета нет или все retry упали — кладёт запрос в outbox,
 * показывает error-toast и вызывает onRollback (если задан).
 *
 * Возвращает true, если запрос ушёл успешно, false — если в outbox.
 */
export async function mutateSafely(opts: MutateOptions): Promise<boolean> {
  const maxRetries = opts.maxRetries ?? DEFAULT_RETRIES
  const init: RequestInit = {
    method: opts.method,
    ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
  }

  // Если мы заведомо оффлайн — сразу в outbox, не тратим время на 3 попытки fetch
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    enqueue(opts, 'offline')
    return false
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await apiFetch(opts.url, init)
      if (res.ok) return true
      // 4xx — не повторяем, это логическая ошибка
      if (res.status >= 400 && res.status < 500) {
        showToast({ kind: 'error', message: `${opts.label}: ошибка ${res.status}` })
        opts.onRollback?.()
        return false
      }
      // 5xx — ретраим
    } catch {
      // Сетевая ошибка — ретраим
    }
    if (attempt < maxRetries) {
      await sleep(BACKOFF_MS[attempt] ?? 1000)
    }
  }

  // Все попытки упали — в outbox
  enqueue(opts, 'failed')
  opts.onRollback?.()
  return false
}

function enqueue(opts: MutateOptions, reason: 'offline' | 'failed'): OutboxEntry {
  const entry = pushToOutbox({
    method: opts.method,
    url: opts.url,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    label: opts.label,
  })
  const tail = reason === 'offline' ? 'отправлю когда появится сеть' : 'отправлю автоматически'
  showToast({
    kind: 'error',
    message: `${opts.label} не сохранилось — ${tail}`,
    duration: 4000,
  })
  return entry
}

/**
 * Пытается отправить все накопленные в outbox мутации.
 * Вызывается при `window: online` и при загрузке страницы.
 */
export async function flushOutbox(entries: OutboxEntry[]): Promise<void> {
  for (const entry of entries) {
    updateOutboxEntry(entry.id, { attempts: entry.attempts + 1 })
    try {
      const res = await apiFetch(entry.url, {
        method: entry.method,
        ...(entry.body !== undefined && { body: entry.body }),
      })
      if (res.ok) {
        removeFromOutbox(entry.id)
        showToast({ kind: 'success', message: `${entry.label}: отправлено`, duration: 1500 })
      } else if (res.status >= 400 && res.status < 500) {
        // Запрос невалидный, ретрай не поможет — выкидываем из outbox молча,
        // чтобы он не висел вечно. Пользователь уже видел ошибку при первом фейле.
        removeFromOutbox(entry.id)
      }
      // 5xx или сетевая ошибка — оставляем в outbox для следующего раза
    } catch {
      // Снова нет сети — оставляем
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
