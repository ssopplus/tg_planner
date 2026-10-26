'use client'

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/telegram/webapp'
import { useReading } from '@/components/reading/reading-provider'
import { TextPicker, useSelectedText } from '@/components/reading/text-picker'
import { Btn, Lede, Panel, Slider, Tip, fieldClass } from '@/components/reading/ui'
import { WordReader } from '@/components/reading/word-reader'
import {
  COMPREHENSION_THRESHOLD,
  computeWpm,
  effectiveWpm,
  formatDuration,
  recommendedPacerWpm,
} from '@/lib/reading/stats'
import type { ReadingQuestion } from '@/lib/reading/types'

type Phase = 'idle' | 'reading' | 'quiz' | 'done'

/**
 * Тест скорости: текст размыт до старта, «Готово» фиксирует время, потом
 * вопросы на понимание. У своего текста без вопросов — пересказ и самооценка,
 * либо вопросы, сгенерированные по тексту.
 */
export default function ReadingTestPage() {
  const { addSession, reloadTexts } = useReading()
  const { text, list, select } = useSelectedText()
  const [phase, setPhase] = useState<Phase>('idle')
  const [startedAt, setStartedAt] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [selfComp, setSelfComp] = useState(70)
  const [retell, setRetell] = useState('')
  const [peek, setPeek] = useState(false)
  const [result, setResult] = useState<{ wpm: number; comp: number } | null>(null)
  const [generating, setGenerating] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const questions: ReadingQuestion[] | null = text?.questions?.length ? text.questions : null

  const reset = () => {
    if (timer.current) clearInterval(timer.current)
    setPhase('idle')
    setElapsed(0)
    setAnswers({})
    setRetell('')
    setPeek(false)
    setResult(null)
  }

  useEffect(() => () => clearInterval(timer.current ?? undefined), [])
  // Другой текст — новый тест с начала.
  useEffect(reset, [text?.id])

  if (!text) return null

  const start = () => {
    const now = Date.now()
    setStartedAt(now)
    setElapsed(0)
    setPhase('reading')
    timer.current = setInterval(() => setElapsed(Date.now() - now), 500)
  }

  const finish = () => {
    if (timer.current) clearInterval(timer.current)
    setElapsed(Date.now() - startedAt)
    setPhase('quiz')
  }

  const wpm = computeWpm(text.wordCount, elapsed)

  const submit = async (comp: number) => {
    setResult({ wpm, comp })
    setPhase('done')
    await addSession({ type: 'test', wpm, comp, ms: elapsed, textId: text.id, title: text.title })
  }

  const checkAnswers = () => {
    if (!questions) return
    const ok = questions.filter((q, i) => answers[i] === q.answer).length
    submit(Math.round((ok / questions.length) * 100))
  }

  const generateQuestions = async () => {
    setGenerating(true)
    try {
      const res = await apiFetch(`/api/reading/texts/${text.id}/questions`, { method: 'POST' })
      if (res.ok) await reloadTexts()
    } finally {
      setGenerating(false)
    }
  }

  const blurred = phase === 'idle' || ((phase === 'quiz' || phase === 'done') && !peek)

  return (
    <Panel title="Тест скорости" aside={`${text.wordCount} слов`}>
      <Lede>
        Читайте в обычном темпе, без указки. Нажмите «Готово», когда дочитаете, и ответьте на
        вопросы: скорость без понимания не считается.
      </Lede>
      <TextPicker list={list} value={text.id} onChange={select} disabled={phase === 'reading'} />

      {phase === 'idle' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="primary" onClick={start}>
            Начать чтение
          </Btn>
          {!questions && text.source !== 'builtin' ? (
            <Btn size="sm" onClick={generateQuestions} disabled={generating}>
              {generating ? 'Составляю вопросы…' : 'Составить вопросы по тексту'}
            </Btn>
          ) : null}
        </div>
      ) : null}

      {phase === 'reading' ? (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-[var(--tg-theme-section-bg-color,#fff)] py-1">
          <span className="font-mono text-[26px] tabular-nums">{formatDuration(elapsed)}</span>
          <Btn variant="primary" onClick={finish}>
            Готово
          </Btn>
        </div>
      ) : null}

      <WordReader
        body={text.body}
        lang={text.lang}
        className={blurred ? 'pointer-events-none select-none blur-[6px]' : ''}
      />

      {phase === 'quiz' || phase === 'done' ? (
        <div className="flex flex-col gap-3">
          <div className="flex gap-6">
            <Result value={wpm} label="слов в минуту" />
            <Result value={formatDuration(elapsed)} label="время" />
          </div>

          {questions ? (
            <div className="flex flex-col">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--tg-theme-hint-color,#8e8e93)]">
                Вопросы на понимание
              </h3>
              {questions.map((q, i) => (
                <fieldset key={i} className="flex flex-col gap-1 border-t border-border py-3">
                  <legend className="mb-1 text-[14px] font-medium">
                    {i + 1}. {q.q}
                  </legend>
                  {q.options.map((option, j) => {
                    const checked = answers[i] === j
                    const verdict =
                      phase === 'done'
                        ? j === q.answer
                          ? 'bg-[color-mix(in_srgb,var(--color-success,#34c759)_20%,transparent)]'
                          : checked
                            ? 'bg-[color-mix(in_srgb,var(--destructive,#ff3b30)_16%,transparent)]'
                            : ''
                        : ''
                    return (
                      <label
                        key={j}
                        className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-[14px] ${verdict}`}
                      >
                        <input
                          type="radio"
                          name={`q${i}`}
                          checked={checked}
                          disabled={phase === 'done'}
                          onChange={() => setAnswers((a) => ({ ...a, [i]: j }))}
                          className="mt-1 accent-[var(--tg-theme-button-color,#007aff)]"
                        />
                        <span>{option}</span>
                      </label>
                    )
                  })}
                </fieldset>
              ))}
              {phase === 'quiz' ? (
                <Btn
                  variant="primary"
                  onClick={checkAnswers}
                  disabled={Object.keys(answers).length < questions.length}
                  className="self-start"
                >
                  Проверить
                </Btn>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--tg-theme-hint-color,#8e8e93)]">
                Перескажите суть
              </h3>
              <Lede>
                Запишите 3–5 главных мыслей, затем загляните в текст и честно оцените, сколько
                уловили.
              </Lede>
              <textarea
                value={retell}
                onChange={(e) => setRetell(e.target.value)}
                rows={4}
                disabled={phase === 'done'}
                className={`${fieldClass} resize-y`}
              />
              <Slider
                label="Понимание"
                value={selfComp}
                min={0}
                max={100}
                step={10}
                suffix="%"
                onChange={setSelfComp}
              />
              <div className="flex gap-2">
                <Btn size="sm" onClick={() => setPeek((v) => !v)}>
                  {peek ? 'Скрыть текст' : 'Показать текст'}
                </Btn>
                {phase === 'quiz' ? (
                  <Btn variant="primary" size="sm" onClick={() => submit(selfComp)}>
                    Сохранить
                  </Btn>
                ) : null}
              </div>
            </div>
          )}

          {result ? (
            <>
              <div className="flex gap-6">
                <Result value={`${result.comp}%`} label="понимание" />
                <Result
                  value={effectiveWpm(result.wpm, result.comp)}
                  label="эффективная скорость"
                />
              </div>
              <Tip>
                {result.comp < COMPREHENSION_THRESHOLD
                  ? 'Понимание ниже 70%: в следующий раз читайте немного медленнее.'
                  : 'Хороший баланс скорости и понимания.'}{' '}
                Указку на следующих тренировках ставьте на {recommendedPacerWpm(result.wpm)}{' '}
                слов/мин.
              </Tip>
              <Btn onClick={reset} className="self-start">
                Пройти ещё раз
              </Btn>
            </>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}

function Result({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[28px] tabular-nums">{value}</span>
      <span className="text-[12px] text-[var(--tg-theme-hint-color,#8e8e93)]">{label}</span>
    </div>
  )
}
