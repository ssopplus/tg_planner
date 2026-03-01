'use client'

import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'

interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  className?: string
}

export function Checkbox({ checked, onChange, className }: CheckboxProps) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors',
        checked
          ? 'border-[var(--tg-theme-button-color,#3b82f6)] bg-[var(--tg-theme-button-color,#3b82f6)]'
          : 'border-[var(--tg-theme-hint-color,#9ca3af)]',
        className,
      )}
    >
      {checked && <Check className="h-3 w-3 text-white" />}
    </button>
  )
}
