'use client'

import { useRef, useCallback, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, X } from 'lucide-react'
import { TaskCard, type TaskCardData } from './task-card'

interface SwipeableTaskCardProps {
  task: TaskCardData
  onComplete?: (id: string) => void
  onRemove?: (id: string) => void
  onMyDayToggle?: (id: string, add: boolean) => void
  showProject?: boolean
}

const SWIPE_THRESHOLD = 80
const MAX_SWIPE = 140
// Ниже — не считаем «жест», а обычный клик. Даёт возможность нажимать
// на кнопки внутри карточки (тоггл готово, солнце, ссылку и т.п.) мышью.
const DRAG_ACTIVATION = 8

export function SwipeableTaskCard({
  task,
  onComplete,
  onRemove,
  onMyDayToggle,
  showProject,
}: SwipeableTaskCardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const currentX = useRef(0)
  const activePointerId = useRef<number | null>(null)
  // null — ещё не решили. true — жест по X. false — вертикальный скролл / клик.
  const isHorizontal = useRef<boolean | null>(null)
  const [swipeOffset, setSwipeOffset] = useState(0)

  const resetSwipe = useCallback(() => {
    setSwipeOffset(0)
    if (containerRef.current) {
      containerRef.current.style.transition = 'transform 0.3s cubic-bezier(.2,.8,.2,1)'
      containerRef.current.style.transform = ''
    }
  }, [])

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Только основная кнопка мыши / пальец / стилус. Игнорируем правую кнопку.
    if (e.pointerType === 'mouse' && e.button !== 0) return
    startX.current = e.clientX
    startY.current = e.clientY
    currentX.current = 0
    activePointerId.current = e.pointerId
    isHorizontal.current = null
  }, [])

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return

    const diffX = e.clientX - startX.current
    const diffY = e.clientY - startY.current

    if (isHorizontal.current === null) {
      if (Math.abs(diffX) > DRAG_ACTIVATION || Math.abs(diffY) > DRAG_ACTIVATION) {
        isHorizontal.current = Math.abs(diffX) > Math.abs(diffY)
        if (isHorizontal.current) {
          // Захватываем указатель, чтобы получать move/up даже если курсор
          // ушёл за границы карточки — иначе на десктопе жест рвётся.
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* setPointerCapture может кинуть, если указатель уже отпущен */
          }
        }
      }
      return
    }

    if (!isHorizontal.current) return

    currentX.current = diffX
    const clampedX = Math.max(-MAX_SWIPE, Math.min(MAX_SWIPE, diffX))
    setSwipeOffset(clampedX)

    if (containerRef.current) {
      containerRef.current.style.transition = 'none'
      containerRef.current.style.transform = `translateX(${clampedX}px)`
    }
  }, [])

  const handlePointerEnd = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (activePointerId.current !== e.pointerId) return
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
      } catch {
        /* noop */
      }

      const wasHorizontal = isHorizontal.current === true
      activePointerId.current = null
      isHorizontal.current = null

      if (!wasHorizontal) {
        setSwipeOffset(0)
        return
      }

      if (currentX.current < -SWIPE_THRESHOLD) {
        if (containerRef.current) {
          containerRef.current.style.transition =
            'transform 0.25s ease-out, opacity 0.25s ease-out'
          containerRef.current.style.transform = 'translateX(-100%)'
          containerRef.current.style.opacity = '0'
        }
        setTimeout(() => {
          onComplete?.(task.id)
          resetSwipe()
          if (containerRef.current) {
            containerRef.current.style.opacity = '1'
          }
        }, 250)
      } else if (currentX.current > SWIPE_THRESHOLD) {
        if (containerRef.current) {
          containerRef.current.style.transition =
            'transform 0.25s ease-out, opacity 0.25s ease-out'
          containerRef.current.style.transform = 'translateX(100%)'
          containerRef.current.style.opacity = '0'
        }
        setTimeout(() => {
          onRemove?.(task.id)
          resetSwipe()
          if (containerRef.current) {
            containerRef.current.style.opacity = '1'
          }
        }, 250)
      } else {
        resetSwipe()
      }

      setSwipeOffset(0)
    },
    [task.id, onComplete, onRemove, resetSwipe],
  )

  const leftReveal = swipeOffset > 0
  const rightReveal = swipeOffset < 0

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Фон слева — убрать из дня (свайп вправо) */}
      <div
        className={`absolute inset-0 flex items-center px-5 rounded-xl bg-orange-500 transition-opacity ${
          leftReveal ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="flex items-center gap-2 text-white">
          <X className="h-5 w-5" />
          <span className="text-sm font-medium">Убрать</span>
        </div>
      </div>

      {/* Фон справа — завершить (свайп влево) */}
      <div
        className={`absolute inset-0 flex items-center justify-end px-5 rounded-xl bg-green-500 transition-opacity ${
          rightReveal ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="flex items-center gap-2 text-white">
          <span className="text-sm font-medium">Готово</span>
          <Check className="h-5 w-5" />
        </div>
      </div>

      {/* Карточка */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        className="relative z-10 touch-pan-y"
      >
        <TaskCard task={task} showProject={showProject} onMyDayToggle={onMyDayToggle} />
      </div>
    </div>
  )
}
