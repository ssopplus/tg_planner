'use client'

/** Заглушка упражнения, которое появится на следующих этапах (см. план в vault). */
export function StagePlaceholder({
  title,
  description,
  stage,
}: {
  title: string
  description: string
  stage: number
}) {
  return (
    <section className="mx-4 flex flex-col gap-2 rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold text-[var(--tg-theme-text-color,#000)]">
          {title}
        </h2>
        <span className="shrink-0 rounded-full bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-2.5 py-1 text-[11px] text-[var(--tg-theme-hint-color,#8e8e93)]">
          этап {stage}
        </span>
      </div>
      <p className="text-[13px] leading-snug text-[var(--tg-theme-hint-color,#8e8e93)]">
        {description}
      </p>
    </section>
  )
}
