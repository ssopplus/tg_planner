'use client'

/**
 * Минимальная toast-инфраструктура: event-emitter поверх Set<Listener>.
 *
 * Используется компонентом <ToastHost /> для рендеринга очереди.
 * Публикуют — `showToast()`, подписываются — `subscribeToasts()`.
 */

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
  /** ms; 0 = не скрывать автоматически */
  duration: number
}

type Listener = (toasts: Toast[]) => void

const listeners = new Set<Listener>()
let queue: Toast[] = []

function emit() {
  for (const l of listeners) l(queue)
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  listener(queue)
  return () => {
    listeners.delete(listener)
  }
}

export function showToast(input: {
  kind?: ToastKind
  message: string
  duration?: number
}): string {
  const id = crypto.randomUUID()
  const toast: Toast = {
    id,
    kind: input.kind ?? 'info',
    message: input.message,
    duration: input.duration ?? 2500,
  }
  queue = [...queue, toast]
  emit()
  if (toast.duration > 0) {
    setTimeout(() => dismissToast(id), toast.duration)
  }
  return id
}

export function dismissToast(id: string): void {
  queue = queue.filter((t) => t.id !== id)
  emit()
}
