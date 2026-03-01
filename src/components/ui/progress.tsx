import { cn } from '@/lib/utils'

interface ProgressProps {
  value: number // 0-100
  className?: string
}

export function Progress({ value, className }: ProgressProps) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700', className)}>
      <div
        className="h-full rounded-full bg-[var(--tg-theme-button-color,#3b82f6)] transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}
