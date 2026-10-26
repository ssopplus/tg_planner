'use client'

import { useLayoutEffect, useRef } from 'react'

/**
 * Последнее значение для таймеров и кадров анимации: цикл, запущенный раньше,
 * видит новый темп с ползунка без перезапуска. Ref обновляется в эффекте —
 * писать в ref во время рендера нельзя.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  }, [value])
  return ref
}
