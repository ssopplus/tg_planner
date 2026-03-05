'use client'

import { useRef, useState, useCallback, type TouchEvent, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void
  children: ReactNode
}

const THRESHOLD = 70
const MAX_PULL = 120

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const startY = useRef(0)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const isPulling = useRef(false)

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (refreshing) return
      const scrollTop = containerRef.current?.scrollTop ?? window.scrollY
      if (scrollTop <= 0) {
        startY.current = e.touches[0].clientY
        isPulling.current = true
      }
    },
    [refreshing],
  )

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isPulling.current || refreshing) return
      const diff = e.touches[0].clientY - startY.current
      if (diff > 0) {
        const dampened = Math.min(diff * 0.4, MAX_PULL)
        setPullDistance(dampened)
      }
    },
    [refreshing],
  )

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current || refreshing) return
    isPulling.current = false

    if (pullDistance >= THRESHOLD) {
      setRefreshing(true)
      setPullDistance(40)
      await onRefresh()
      setRefreshing(false)
    }
    setPullDistance(0)
  }, [pullDistance, refreshing, onRefresh])

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="relative"
    >
      <div
        className="flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out"
        style={{ height: pullDistance }}
      >
        <RefreshCw
          className={`h-5 w-5 text-[var(--tg-theme-hint-color,#8e8e93)] transition-transform duration-200 ${
            refreshing ? 'animate-spin' : ''
          }`}
          style={{
            transform: refreshing
              ? undefined
              : `rotate(${Math.min((pullDistance / THRESHOLD) * 360, 360)}deg)`,
            opacity: Math.min(pullDistance / (THRESHOLD * 0.6), 1),
          }}
        />
      </div>
      {children}
    </div>
  )
}
