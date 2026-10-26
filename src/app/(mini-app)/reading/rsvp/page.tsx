'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useReading } from '@/components/reading/reading-provider'
import { TextPicker, useSelectedText } from '@/components/reading/text-picker'
import { Btn, Chip, Lede, Panel, Slider } from '@/components/reading/ui'
import { useLatest } from '@/components/reading/use-latest'
import { chunkDelayMs, splitAtOrp } from '@/lib/reading/rsvp'
import { WPM_LIMITS } from '@/lib/reading/settings'
import { MIN_SESSION_MS } from '@/lib/reading/stats'
import { splitWords } from '@/lib/reading/text-utils'
import type { ReadingText } from '@/lib/reading/types'

/** На паузе после минуты чтения тренировка записывается сразу: «Продолжить» начнёт новую. */
const RECORD_ON_PAUSE_MS = 60_000

/**
 * Разминка: слова по одному (или 1–3) в фиксированной точке. Опорная буква
 * выделена цветом и стоит строго по центру, глазам не нужно двигаться.
 */
export default function ReadingRsvpPage() {
  const { settings, updateSettings } = useReading()
  const { text, list, select } = useSelectedText()
  const [running, setRunning] = useState(false)
  if (!text) return null

  return (
    <Panel title="Разминка: слова по одному">
      <Lede>
        Слова появляются в одной точке, глазам не нужно двигаться. Смотрите на метки и не пытайтесь
        проговорить каждое слово целиком. 2 минуты.
      </Lede>
      <TextPicker list={list} value={text.id} onChange={select} disabled={running} />
      <Slider
        label="Темп"
        value={settings.rsvpWpm}
        min={WPM_LIMITS.rsvp.min}
        max={WPM_LIMITS.rsvp.max}
        step={10}
        suffix="сл/мин"
        onChange={(v) => updateSettings({ rsvpWpm: v })}
      />
      <div className="flex items-center gap-2 text-[13px] text-[var(--tg-theme-hint-color,#8e8e93)]">
        <span>Слов за раз</span>
        {([1, 2, 3] as const).map((n) => (
          <Chip
            key={n}
            active={settings.rsvpChunk === n}
            onClick={() => updateSettings({ rsvpChunk: n })}
          >
            {n}
          </Chip>
        ))}
      </div>
      {/* key: другой текст — разминка с начала. */}
      <RsvpRunner key={text.id} text={text} onRunningChange={setRunning} />
    </Panel>
  )
}

function RsvpRunner({
  text,
  onRunningChange,
}: {
  text: ReadingText
  onRunningChange: (running: boolean) => void
}) {
  const { settings, addSession } = useReading()
  const words = useMemo(() => splitWords(text.body), [text.body])
  const [shown, setShown] = useState<string[]>(['Готовы?'])
  const [position, setPosition] = useState(0)
  const [running, setRunning] = useState(false)

  const index = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedAt = useRef(0)
  const elapsed = useRef(0)
  const wpm = useLatest(settings.rsvpWpm)
  const chunk = useLatest(settings.rsvpChunk)

  useEffect(() => () => clearTimeout(timer.current ?? undefined), [])

  const setRunningBoth = (value: boolean) => {
    setRunning(value)
    onRunningChange(value)
  }

  const record = () => {
    if (elapsed.current > (MIN_SESSION_MS.rsvp ?? 0)) {
      addSession({
        type: 'rsvp',
        wpm: wpm.current,
        ms: Math.round(elapsed.current),
        textId: text.id,
        title: text.title,
      })
    }
    elapsed.current = 0
  }

  const stop = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
      elapsed.current += Date.now() - startedAt.current
    }
    setRunningBoth(false)
  }

  const reset = () => {
    stop()
    index.current = 0
    elapsed.current = 0
    setPosition(0)
    setShown(['Готовы?'])
  }

  /** Цикл показа: каждая группа слов планирует следующую со своей паузой. */
  const run = () => {
    const step = () => {
      if (index.current >= words.length) {
        stop()
        setShown(['Готово'])
        record()
        return
      }
      const group = words.slice(index.current, index.current + chunk.current)
      index.current += group.length
      setShown(group)
      setPosition(index.current)
      timer.current = setTimeout(step, chunkDelayMs(group, wpm.current))
    }
    step()
  }

  const toggle = () => {
    if (running) {
      stop()
      if (elapsed.current > RECORD_ON_PAUSE_MS) record()
      return
    }
    if (index.current >= words.length) reset()
    startedAt.current = Date.now()
    setRunningBoth(true)
    run()
  }

  const label = running ? 'Пауза' : position > 0 && position < words.length ? 'Продолжить' : 'Старт'

  return (
    <>
      <div className="relative grid h-40 place-items-center overflow-hidden rounded-xl border border-border bg-[var(--tg-theme-bg-color,#f2f2f7)]">
        <span className="absolute left-1/2 top-7 h-4 w-0.5 -translate-x-1/2 bg-[var(--tg-theme-button-color,#007aff)]" />
        <span className="absolute bottom-7 left-1/2 h-4 w-0.5 -translate-x-1/2 bg-[var(--tg-theme-button-color,#007aff)]" />
        <RsvpWord words={shown} />
      </div>
      <div className="flex items-center gap-2">
        <Btn variant="primary" onClick={toggle}>
          {label}
        </Btn>
        <Btn onClick={reset}>Сначала</Btn>
        <span className="ml-auto font-mono text-[13px] tabular-nums text-[var(--tg-theme-hint-color,#8e8e93)]">
          {position} / {words.length}
        </span>
      </div>
    </>
  )
}

function RsvpWord({ words }: { words: string[] }) {
  const font = 'font-[family-name:var(--font-reading)] text-[var(--tg-theme-text-color,#000)]'
  if (words.length !== 1) {
    return <div className={`${font} px-4 text-center text-[28px]`}>{words.join(' ')}</div>
  }
  const [left, pivot, right] = splitAtOrp(words[0])
  return (
    <div className={`${font} grid w-full grid-cols-[1fr_auto_1fr] whitespace-pre text-[36px]`}>
      <span className="text-right">{left}</span>
      <span className="text-[var(--destructive,#ff3b30)]">{pivot}</span>
      <span className="text-left">{right}</span>
    </div>
  )
}
