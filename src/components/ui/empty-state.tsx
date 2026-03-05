'use client'

interface EmptyStateProps {
  icon: string
  title: string
  description: string
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="text-6xl mb-4 animate-[bounce_2s_ease-in-out_infinite]">{icon}</div>
      <h3 className="text-lg font-semibold text-[var(--tg-theme-text-color,#000)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--tg-theme-hint-color,#8e8e93)] max-w-[240px]">{description}</p>
    </div>
  )
}
