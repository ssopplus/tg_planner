'use client'

import { hapticImpact } from '@/lib/telegram/webapp'

export interface TabItem {
  id: string
  label: string
  /** Эмодзи перед названием — так доски различаются быстрее, чем по тексту. */
  emoji?: string | null
  /** Число справа от названия: сколько задач внутри. 0 не показываем. */
  count?: number
}

/**
 * Горизонтальная лента переключателей: статусы в разделе Трекера, доски — в
 * личном. Листается свайпом, потому что элементов может быть больше, чем
 * влезает в ширину экрана.
 *
 * `touch-pan-x` вместо `touch-none`: прокрутку ленты отдаём браузеру, иначе
 * палец на вкладке её не листает.
 */
export function TabStrip({
  items,
  activeId,
  onSelect,
  action,
}: {
  items: TabItem[]
  activeId: string
  onSelect: (id: string) => void
  /** Кнопка в конце ленты — например «＋» для новой доски. */
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto touch-pan-x px-4 pb-1 scrollbar-none">
      {items.map((item) => {
        const isActive = item.id === activeId
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (!isActive) hapticImpact('light')
              onSelect(item.id)
            }}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
              isActive
                ? 'bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)]'
                : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-hint-color,#8e8e93)]'
            }`}
          >
            {item.emoji ? <span className="mr-1">{item.emoji}</span> : null}
            {item.label}
            {item.count ? <span className="ml-1.5 opacity-70">{item.count}</span> : null}
          </button>
        )
      })}

      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          aria-label={action.label}
          className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-hint-color,#8e8e93)]"
        >
          ＋
        </button>
      ) : null}
    </div>
  )
}
