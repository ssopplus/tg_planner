'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useReading } from '@/components/reading/reading-provider'
import { useLatest } from '@/components/reading/use-latest'
import { TextPicker, useSelectedText } from '@/components/reading/text-picker'
import { Btn, Lede, Panel, Slider, Toggle } from '@/components/reading/ui'
import { WordReader } from '@/components/reading/word-reader'
import { WPM_LIMITS } from '@/lib/reading/settings'
import { formatDuration, MIN_SESSION_MS } from '@/lib/reading/stats'

const DURATION_MS = 5 * 60_000

/**
 * Чтение без голоса: четыре точки пульсируют в ритме, пользователь считает про
 * себя «раз-два-три-четыре». Внутренний голос занят счётом, и смысл приходится
 * брать глазами. Щелчок — WebAudio, сильная доля выше тоном.
 */
export default function ReadingSilentPage() {
  const { settings, updateSettings, addSession } = useReading()
  const { text, list, select } = useSelectedText()
  const [dim, setDim] = useState(false)
  const [sound, setSound] = useState(false)
  const [beat, setBeat] = useState(-1)
  const [left, setLeft] = useState(DURATION_MS)
  const [running, setRunning] = useState(false)

  const beatTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const clock = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAt = useRef(0)
  const count = useRef(0)
  const audio = useRef<AudioContext | null>(null)
  const soundOn = useLatest(sound)

  const click = (strong: boolean) => {
    try {
      audio.current ??= new AudioContext()
      const ac = audio.current
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.frequency.value = strong ? 1100 : 800
      gain.gain.setValueAtTime(0.15, ac.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.06)
      osc.connect(gain).connect(ac.destination)
      osc.start()
      osc.stop(ac.currentTime + 0.07)
    } catch {
      // Без звука упражнение всё равно работает — точки видны.
    }
  }

  const tickBeat = useCallback(() => {
    const k = count.current % 4
    setBeat(k)
    if (soundOn.current) click(k === 0)
    count.current += 1
  }, [soundOn])

  const startBeat = useCallback(
    (bpm: number) => {
      if (beatTimer.current) clearInterval(beatTimer.current)
      beatTimer.current = setInterval(tickBeat, 60_000 / bpm)
    },
    [tickBeat],
  )

  const stop = useCallback(
    (record: boolean) => {
      if (!clock.current) return
      clearInterval(clock.current)
      clock.current = null
      if (beatTimer.current) clearInterval(beatTimer.current)
      setBeat(-1)
      setRunning(false)
      setLeft(DURATION_MS)
      const ms = Math.min(DURATION_MS, Date.now() - startedAt.current)
      if (record && text && ms > (MIN_SESSION_MS.silent ?? 0)) {
        addSession({ type: 'silent', ms, textId: text.id, title: text.title })
      }
    },
    [addSession, text],
  )

  useEffect(
    () => () => {
      clearInterval(clock.current ?? undefined)
      clearInterval(beatTimer.current ?? undefined)
      audio.current?.close().catch(() => {})
    },
    [],
  )

  const toggle = () => {
    if (running) {
      stop(true)
      return
    }
    startedAt.current = Date.now()
    count.current = 0
    setRunning(true)
    startBeat(settings.silentBpm)
    tickBeat()
    clock.current = setInterval(() => {
      const rest = startedAt.current + DURATION_MS - Date.now()
      setLeft(Math.max(0, rest))
      if (rest <= 0) stop(true)
    }, 250)
  }

  if (!text) return null

  return (
    <Panel title="Чтение без голоса">
      <Lede>
        Читайте и одновременно отсчитывайте про себя «раз-два-три-четыре» под пульс точек.
        Внутренний голос занят счётом, и смысл приходится брать глазами. Понимание сначала просядет
        — это нормально.
      </Lede>
      <TextPicker list={list} value={text.id} onChange={select} disabled={running} />
      <Slider
        label="Ритм"
        value={settings.silentBpm}
        min={WPM_LIMITS.silentBpm.min}
        max={WPM_LIMITS.silentBpm.max}
        step={5}
        suffix="уд/мин"
        onChange={(v) => {
          updateSettings({ silentBpm: v })
          if (running) startBeat(v)
        }}
      />
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Toggle label="Приглушить служебные слова" checked={dim} onChange={setDim} />
        <Toggle label="Щелчок" checked={sound} onChange={setSound} />
      </div>

      <div className="flex justify-center gap-4 py-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full transition-transform duration-75 motion-reduce:transition-none ${
              beat === i
                ? 'scale-125 bg-[var(--tg-theme-button-color,#007aff)]'
                : 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)]'
            }`}
          />
        ))}
      </div>

      <div className="max-h-[52vh] overflow-y-auto px-1.5">
        <WordReader body={text.body} lang={text.lang} dimFunctionWords={dim} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <Btn variant="primary" onClick={toggle}>
          {running ? 'Закончить' : 'Старт · 5:00'}
        </Btn>
        <span className="font-mono text-[26px] tabular-nums">{formatDuration(left)}</span>
      </div>
    </Panel>
  )
}
