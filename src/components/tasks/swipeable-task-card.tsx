'use client'

import { useRef, useCallback, useState, type TouchEvent } from 'react'
import { Check, X } from 'lucide-react'
import { TaskCard, type TaskCardData } from './task-card'

interface SwipeableTaskCardProps {
  task: TaskCardData
  onComplete?: (id: string) => void
  onRemove?: (id: string) => void
  showProject?: boolean
}

const SWIPE_THRESHOLD = 80
const MAX_SWIPE = 140

export function SwipeableTaskCard({ task, onComplete, onRemove, showProject }: SwipeableTaskCardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const currentX = useRef(0)
  const isHorizontal = useRef<boolean | null>(null)
  const [swipeOffset, setSwipeOffset] = useState(0)

  const resetSwipe = useCallback(() => {
    setSwipeOffset(0)
    if (containerRef.current) {
      containerRef.current.style.transition = 'transform 0.3s cubic-bezier(.2,.8,.2,1)'
      containerRef.current.style.transform = ''
    }
  }, [])

  const handleTouchStart = useCallback((e: TouchEvent) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    currentX.current = 0
    isHorizontal.current = null
  }, [])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const diffX = e.touches[0].clientX - startX.current
    const diffY = e.touches[0].clientY - startY.current

    if (isHorizontal.current === null) {
      if (Math.abs(diffX) > 8 || Math.abs(diffY) > 8) {
        isHorizontal.current = Math.abs(diffX) > Math.abs(diffY)
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

  const handleTouchEnd = useCallback(() => {
    if (currentX.current < -SWIPE_THRESHOLD) {
      if (containerRef.current) {
        containerRef.current.style.transition = 'transform 0.25s ease-out, opacity 0.25s ease-out'
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
        containerRef.current.style.transition = 'transform 0.25s ease-out, opacity 0.25s ease-out'
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

    isHorizontal.current = null
    setSwipeOffset(0)
  }, [task.id, onComplete, onRemove, resetSwipe])

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
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="relative z-10"
      >
        <TaskCard task={task} showProject={showProject} />
      </div>
    </div>
  )
}
