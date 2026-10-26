'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useReading } from '@/components/reading/reading-provider'
import { TextPicker, useSelectedText } from '@/components/reading/text-picker'
import { Btn, Lede, Panel, Slider, Tip } from '@/components/reading/ui'
import { useLatest } from '@/components/reading/use-latest'
import { WordReader } from '@/components/reading/word-reader'
import { groupLines, lineDurationMs, type VisualLine } from '@/lib/reading/lines'
import { WPM_LIMITS } from '@/lib/reading/settings'
import { MIN_SESSION_MS, nextPacerWpm } from '@/lib/reading/stats'
import type { ReadingText } from '@/lib/reading/types'

/** Прочитанные слова приглушаются — класс ставится напрямую в DOM, без перерисовки текста. */
const READ_CLASS = 'text-[var(--tg-theme-hint-color,#8e8e93)]'

/** Текущая строка держится на 30% высоты окна чтения. */
const FOCUS_AT = 0.3

/**
 * Указка: подсветка идёт по визуальным строкам в заданном темпе, под строкой
 * растёт полоса-прогресс. Строки считаются по положению слов и пересчитываются
 * при изменении ширины.
 */
export default function ReadingPacerPage() {
  const { settings, updateSettings } = useReading()
  const { text, list, select } = useSelectedText()
  const [running, setRunning] = useState(false)
  // Повтор того же текста на новом темпе: смена ключа перезапускает указку.
  const [round, setRound] = useState(0)
  if (!text) return null

  return (
    <Panel title="Указка">
      <Lede>
        Подсветка идёт по строке в заданном темпе. Держите взгляд на ней и не возвращайтесь назад.
        Темп ставьте чуть быстрее комфортного: на 10–20% выше вашего теста.
      </Lede>
      <TextPicker list={list} value={text.id} onChange={select} disabled={running} />
      <Slider
        label="Темп"
        value={settings.pacerWpm}
        min={WPM_LIMITS.pacer.min}
        max={WPM_LIMITS.pacer.max}
        step={10}
        suffix="сл/мин"
        onChange={(v) => updateSettings({ pacerWpm: v })}
      />
      <PacerRunner
        key={`${text.id}:${round}`}
        text={text}
        onRunningChange={setRunning}
        onSpeedUp={(wpm) => {
          updateSettings({ pacerWpm: wpm })
          setRound((r) => r + 1)
        }}
      />
    </Panel>
  )
}

function PacerRunner({
  text,
  onRunningChange,
  onSpeedUp,
}: {
  text: ReadingText
  onRunningChange: (running: boolean) => void
  onSpeedUp: (wpm: number) => void
}) {
  const { settings, addSession } = useReading()

  const reader = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const progress = useRef<HTMLDivElement>(null)
  const lines = useRef<VisualLine[]>([])
  const spans = useRef<HTMLElement[]>([])
  const lineIndex = useRef(0)
  const lineStart = useRef(0)
  const startedAt = useRef(0)
  const raf = useRef(0)
  // Флаг для обработчиков: из состояния его не прочитать без лишних перерисовок.
  const isRunning = useRef(false)
  const wpm = useLatest(settings.pacerWpm)

  const [running, setRunning] = useState(false)
  const [current, setCurrent] = useState(0)
  const [total, setTotal] = useState(0)
  const [finishedAt, setFinishedAt] = useState<number | null>(null)

  const measure = useCallback(() => {
    const root = reader.current
    if (!root) return
    const rootRect = root.getBoundingClientRect()
    spans.current = Array.from(root.querySelectorAll<HTMLElement>('[data-w]'))
    lines.current = groupLines(
      spans.current.map((el) => {
        const r = el.getBoundingClientRect()
        return {
          top: r.top - rootRect.top,
          left: r.left - rootRect.left,
          width: r.width,
          height: r.height,
        }
      }),
    )
    setTotal(lines.current.length)
  }, [])

  // Строки считаются после отрисовки и заново при смене ширины (поворот, окно Telegram Desktop).
  useEffect(() => {
    const root = reader.current
    if (!root) return
    const observer = new ResizeObserver(() => measure())
    observer.observe(root)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf.current)
    }
  }, [measure])

  const hideMarks = () => {
    if (bar.current) bar.current.hidden = true
    if (progress.current) progress.current.hidden = true
  }

  const setRunningBoth = (value: boolean) => {
    isRunning.current = value
    setRunning(value)
    onRunningChange(value)
  }

  const pause = () => {
    cancelAnimationFrame(raf.current)
    if (isRunning.current) {
      const ms = Date.now() - startedAt.current
      if (ms > (MIN_SESSION_MS.pacer ?? 0)) {
        addSession({ type: 'pacer', wpm: wpm.current, ms, textId: text.id, title: text.title })
      }
    }
    setRunningBoth(false)
  }

  const rewind = () => {
    cancelAnimationFrame(raf.current)
    setRunningBoth(false)
    lineIndex.current = 0
    setCurrent(0)
    setFinishedAt(null)
    hideMarks()
    spans.current.forEach((el) => el.classList.remove(READ_CLASS))
    if (scroller.current) scroller.current.scrollTop = 0
  }

  const finish = () => {
    setRunningBoth(false)
    hideMarks()
    addSession({
      type: 'pacer',
      wpm: wpm.current,
      ms: Date.now() - startedAt.current,
      textId: text.id,
      title: text.title,
    })
    setFinishedAt(wpm.current)
  }

  /** Цикл анимации: каждый кадр двигает подсветку и полосу по текущей строке. */
  const run = (startAt: number) => {
    lineStart.current = startAt
    const frame = (now: number) => {
      const line = lines.current[lineIndex.current]
      if (!line) {
        finish()
        return
      }
      const t = Math.min(
        1,
        (now - lineStart.current) / lineDurationMs(line.words.length, wpm.current),
      )
      if (bar.current && progress.current) {
        bar.current.hidden = false
        progress.current.hidden = false
        Object.assign(bar.current.style, {
          top: `${line.top - 2}px`,
          left: `${line.left - 4}px`,
          width: `${line.right - line.left + 8}px`,
          height: `${line.height + 4}px`,
        })
        Object.assign(progress.current.style, {
          top: `${line.top + line.height + 1}px`,
          left: `${line.left}px`,
          width: `${Math.max(6, (line.right - line.left) * t)}px`,
        })
      }
      const box = scroller.current
      if (box) {
        const target = line.top - box.clientHeight * FOCUS_AT
        if (Math.abs(box.scrollTop - target) > 2) box.scrollTop = target
      }
      if (t >= 1) {
        line.words.forEach((i) => spans.current[i]?.classList.add(READ_CLASS))
        lineIndex.current += 1
        lineStart.current = now
        setCurrent(lineIndex.current)
      }
      raf.current = requestAnimationFrame(frame)
    }
    raf.current = requestAnimationFrame(frame)
  }

  const toggle = () => {
    if (running) {
      pause()
      return
    }
    if (lineIndex.current >= lines.current.length) rewind()
    setFinishedAt(null)
    startedAt.current = Date.now()
    setRunningBoth(true)
    requestAnimationFrame(run)
  }

  const label = running ? 'Пауза' : current > 0 && current < total ? 'Продолжить' : 'Старт'
  const faster = finishedAt ? Math.min(WPM_LIMITS.pacer.max, nextPacerWpm(finishedAt)) : 0

  return (
    <>
      <div ref={scroller} className="max-h-[52vh] overflow-y-auto px-1.5">
        <WordReader ref={reader} body={text.body} lang={text.lang}>
          <div
            ref={bar}
            hidden
            className="pointer-events-none absolute -z-10 rounded bg-[color-mix(in_srgb,var(--tg-theme-button-color,#007aff)_16%,transparent)]"
          />
          <div
            ref={progress}
            hidden
            className="pointer-events-none absolute -z-10 h-[3px] rounded-sm bg-[var(--tg-theme-button-color,#007aff)]"
          />
        </WordReader>
      </div>

      <div className="flex items-center gap-2">
        <Btn variant="primary" onClick={toggle}>
          {label}
        </Btn>
        <Btn onClick={rewind}>Сначала</Btn>
        <span className="ml-auto font-mono text-[13px] tabular-nums text-[var(--tg-theme-hint-color,#8e8e93)]">
          строка {current} / {total}
        </span>
      </div>

      {finishedAt ? (
        <Tip>
          Текст пройден на {finishedAt} слов/мин. Если успевали понимать, попробуйте быстрее:{' '}
          <button
            type="button"
            className="font-semibold text-[var(--tg-theme-button-color,#007aff)] underline"
            onClick={() => onSpeedUp(faster)}
          >
            {faster} слов/мин
          </button>
        </Tip>
      ) : null}
    </>
  )
}
