'use client'

import { useEffect, useState } from 'react'

/**
 * Текущее время, которое обновляется раз в минуту. Рендер должен быть чистым,
 * поэтому «сейчас» для очереди карточек и смены дня берётся отсюда, а не из
 * `Date.now()` прямо в компоненте.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
