'use client'

import { useState, useRef, useCallback } from 'react'
import { TaskCard, type TaskCardData } from './task-card'
import { Check, X } from 'lucide-react'

interface SwipeableTaskCardProps {
  task: TaskCardData
  onComplete?: (id: string) => void
  onRemove?: (id: string) => void
  showProject?: boolean
}

const SWIPE_THRESHOLD = 80

/**
 * Карточка задачи со свайп-действиями:
 * - Свайп влево → завершить задачу
 * - Свайп вправо → убрать из дня
 */
export function SwipeableTaskCard({ task, onComplete, onRemove, showProject }: SwipeableTaskCardProps) {
  const [offset, setOffset] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const isHorizontal = useRef<boolean | null>(null)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    isHorizontal.current = null
    setSwiping(true)
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swiping) return

    const dx = e.touches[0].clientX - startX.current
    const dy = e.touches[0].clientY - startY.current

    // Определяем направление жеста при первом движении
    if (isHorizontal.current === null) {
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        isHorizontal.current = Math.abs(dx) > Math.abs(dy)
      }
      return
    }

    if (!isHorizontal.current) return

    // Ограничение смещения
    const clampedOffset = Math.max(-SWIPE_THRESHOLD * 1.5, Math.min(SWIPE_THRESHOLD * 1.5, dx))
    setOffset(clampedOffset)
  }, [swiping])

  const handleTouchEnd = useCallback(() => {
    setSwiping(false)
    isHorizontal.current = null

    if (offset < -SWIPE_THRESHOLD) {
      // Свайп влево → завершить
      setOffset(-300)
      setTimeout(() => onComplete?.(task.id), 200)
    } else if (offset > SWIPE_THRESHOLD) {
      // Свайп вправо → убрать из дня
      setOffset(300)
      setTimeout(() => onRemove?.(task.id), 200)
    } else {
      setOffset(0)
    }
  }, [offset, task.id, onComplete, onRemove])

  const leftRevealed = offset > 0
  const rightRevealed = offset < 0

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Фон слева — убрать из дня (свайп вправо) */}
      <div className="absolute inset-y-0 left-0 flex w-full items-center bg-orange-500 px-4">
        <div className="flex items-center gap-2 text-white text-sm font-medium">
          <X className="h-5 w-5" />
          <span>Убрать</span>
        </div>
      </div>

      {/* Фон справа — завершить (свайп влево) */}
      <div className="absolute inset-y-0 right-0 flex w-full items-center justify-end bg-green-500 px-4">
        <div className="flex items-center gap-2 text-white text-sm font-medium">
          <span>Готово</span>
          <Check className="h-5 w-5" />
        </div>
      </div>

      {/* Карточка */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="relative z-10 transition-transform duration-200"
        style={{
          transform: `translateX(${offset}px)`,
          transitionDuration: swiping ? '0ms' : '200ms',
        }}
      >
        <TaskCard task={task} showProject={showProject} />
      </div>
    </div>
  )
}
