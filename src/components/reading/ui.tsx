'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** Мелкие кирпичики раздела «Чтение» в стиле остального Mini App (цвета темы Telegram). */

export function Panel({
  title,
  aside,
  children,
  className = '',
}: {
  title?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`mx-4 flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-4 ${className}`}
    >
      {title || aside ? (
        <div className="flex items-center justify-between gap-2">
          {title ? (
            <h2 className="text-[16px] font-semibold text-[var(--tg-theme-text-color,#000)]">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {aside ? (
            <span className="shrink-0 text-[12px] tabular-nums text-[var(--tg-theme-hint-color,#8e8e93)]">
              {aside}
            </span>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function Lede({ children }: { children: ReactNode }) {
  return (
    <p className="text-[13px] leading-snug text-[var(--tg-theme-hint-color,#8e8e93)]">{children}</p>
  )
}

export function Tip({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-[color-mix(in_srgb,var(--tg-theme-button-color,#007aff)_12%,transparent)] px-3 py-2 text-[13px] leading-snug text-[var(--tg-theme-text-color,#000)]">
      {children}
    </div>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary'
  size?: 'md' | 'sm'
}

export function Btn({ variant = 'secondary', size = 'md', className = '', ...props }: ButtonProps) {
  const base =
    size === 'sm' ? 'rounded-lg px-3 py-1.5 text-[13px]' : 'rounded-lg px-4 py-2 text-[14px]'
  const look =
    variant === 'primary'
      ? 'bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)]'
      : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-text-color,#000)]'
  return (
    <button
      type="button"
      className={`${base} ${look} font-medium transition-opacity disabled:opacity-45 ${className}`}
      {...props}
    />
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--tg-theme-hint-color,#8e8e93)]">
      <span className="shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-[var(--tg-theme-button-color,#007aff)]"
      />
      <span className="w-16 shrink-0 text-right font-mono tabular-nums text-[var(--tg-theme-text-color,#000)]">
        {value}
        {suffix ? (
          <span className="text-[11px] text-[var(--tg-theme-hint-color,#8e8e93)]"> {suffix}</span>
        ) : null}
      </span>
    </label>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-[var(--tg-theme-text-color,#000)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--tg-theme-button-color,#007aff)]"
      />
      {label}
    </label>
  )
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-border bg-[var(--tg-theme-section-bg-color,#fff)] p-3">
      <span className="font-mono text-[22px] tabular-nums text-[var(--tg-theme-text-color,#000)]">
        {value}
      </span>
      <span className="text-[11px] leading-tight text-[var(--tg-theme-hint-color,#8e8e93)]">
        {label}
      </span>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-4 text-center text-[13px] text-[var(--tg-theme-hint-color,#8e8e93)]">
      {children}
    </div>
  )
}

export function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium ${
        active
          ? 'bg-[var(--tg-theme-button-color,#007aff)] text-[var(--tg-theme-button-text-color,#fff)]'
          : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)] text-[var(--tg-theme-hint-color,#8e8e93)]'
      }`}
    >
      {children}
    </button>
  )
}

export const fieldClass =
  'w-full min-w-0 rounded-lg border border-border bg-[var(--tg-theme-bg-color,#f2f2f7)] px-3 py-2 text-[14px] text-[var(--tg-theme-text-color,#000)] placeholder:text-[var(--tg-theme-hint-color,#8e8e93)]'
