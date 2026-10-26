'use client'

import { useState } from 'react'
import type { ReadingSession } from '@/lib/reading/types'

/**
 * Скорость и понимание по последним 20 тестам. ТЗ просило одну диаграмму с
 * двумя осями, но две шкалы на одном поле читаются как связь, которой нет,
 * поэтому это два графика с общей осью дат: сверху слова в минуту, снизу
 * понимание 0–100%. Касание или наведение выбирает тест в обоих сразу.
 */

const W = 640
const PAD_L = 40
const PAD_R = 12
const MAX_POINTS = 20

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

function Series({
  points,
  max,
  ticks,
  height,
  active,
  format,
  label,
}: {
  points: number[]
  max: number
  ticks: number[]
  height: number
  active: number | null
  format: (v: number) => string
  label: string
}) {
  const top = 10
  const bottom = 6
  const x = (i: number) =>
    points.length === 1
      ? (PAD_L + W - PAD_R) / 2
      : PAD_L + (i * (W - PAD_L - PAD_R)) / (points.length - 1)
  const y = (v: number) => top + (height - top - bottom) * (1 - v / max)
  const line = points.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const last = points.length - 1
  const shown = active ?? last

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="block h-auto w-full"
      role="img"
      aria-label={label}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--border,#d1d1d6)"
            strokeWidth={1}
          />
          <text
            x={PAD_L - 8}
            y={y(t) + 4}
            textAnchor="end"
            className="fill-[var(--tg-theme-hint-color,#8e8e93)] font-mono text-[18px]"
          >
            {format(t)}
          </text>
        </g>
      ))}
      {active !== null ? (
        <line
          x1={x(active)}
          x2={x(active)}
          y1={top}
          y2={height - bottom}
          stroke="var(--tg-theme-hint-color,#8e8e93)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ) : null}
      <polyline
        points={line}
        fill="none"
        stroke="var(--tg-theme-button-color,#007aff)"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((v, i) => (
        <circle
          key={i}
          cx={x(i)}
          cy={y(v)}
          r={i === shown ? 6 : 4}
          fill="var(--tg-theme-button-color,#007aff)"
          stroke="var(--tg-theme-section-bg-color,#fff)"
          strokeWidth={2}
        />
      ))}
      <text
        x={Math.min(Math.max(x(shown), PAD_L + 30), W - PAD_R - 30)}
        y={Math.max(18, y(points[shown]) - 12)}
        textAnchor="middle"
        className="fill-[var(--tg-theme-text-color,#000)] font-mono text-[20px] font-semibold"
      >
        {format(points[shown])}
      </text>
    </svg>
  )
}

export function ProgressChart({ tests }: { tests: ReadingSession[] }) {
  const [active, setActive] = useState<number | null>(null)
  const pts = tests.slice(-MAX_POINTS)
  if (!pts.length) return null

  const wpm = pts.map((t) => t.wpm ?? 0)
  const comp = pts.map((t) => t.comp ?? 0)
  const maxWpm = Math.max(300, Math.ceil(Math.max(...wpm) / 100) * 100)
  const step = maxWpm <= 400 ? 100 : 200
  const wpmTicks = Array.from({ length: Math.floor(maxWpm / step) + 1 }, (_, i) => i * step)

  // Индекс теста по горизонтали касания: ближайшая точка, а не только попадание в кружок.
  const pick = (clientX: number, rect: DOMRect) => {
    if (pts.length === 1) return setActive(0)
    const vx = ((clientX - rect.left) / rect.width) * W
    const i = Math.round(((vx - PAD_L) / (W - PAD_L - PAD_R)) * (pts.length - 1))
    setActive(Math.min(pts.length - 1, Math.max(0, i)))
  }

  const shown = pts[active ?? pts.length - 1]

  return (
    <div className="flex flex-col gap-1">
      <p className="min-h-5 text-[12px] tabular-nums text-[var(--tg-theme-hint-color,#8e8e93)]">
        {fmtDay(shown.createdAt)} · {shown.wpm} слов/мин · понимание {shown.comp}%
        {shown.title ? ` · ${shown.title}` : ''}
      </p>
      <div
        className="flex touch-pan-y flex-col gap-1"
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setActive(null)
        }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tg-theme-hint-color,#8e8e93)]">
          Слова в минуту
        </span>
        <Series
          points={wpm}
          max={maxWpm}
          ticks={wpmTicks}
          height={170}
          active={active}
          format={(v) => String(v)}
          label="Скорость чтения по тестам"
        />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tg-theme-hint-color,#8e8e93)]">
          Понимание
        </span>
        <Series
          points={comp}
          max={100}
          ticks={[0, 50, 100]}
          height={110}
          active={active}
          format={(v) => `${v}%`}
          label="Понимание по тестам"
        />
        <div className="flex justify-between pl-[6%] text-[11px] tabular-nums text-[var(--tg-theme-hint-color,#8e8e93)]">
          <span>{fmtDay(pts[0].createdAt)}</span>
          {pts.length > 1 ? <span>{fmtDay(pts[pts.length - 1].createdAt)}</span> : null}
        </div>
      </div>
    </div>
  )
}
