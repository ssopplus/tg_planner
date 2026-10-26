'use client'

import { useEffect, useMemo, useState } from 'react'
import { Trash2, Volume2 } from 'lucide-react'
import { webAppConfirm } from '@/lib/telegram/webapp'
import { useReading } from '@/components/reading/reading-provider'
import { speakEnglish } from '@/components/reading/speak'
import { Btn, Empty, Panel } from '@/components/reading/ui'
import { useLatest } from '@/components/reading/use-latest'
import { useNow } from '@/components/reading/use-now'
import { dueQueue } from '@/lib/reading/srs'
import { plural } from '@/lib/reading/stats'
import type { CardGrade, ReadingCard } from '@/lib/reading/types'

/** Предложение-контекст с выделенным словом (словарная форма или встреченная словоформа). */
function Context({ card }: { card: ReadingCard }) {
  const forms = [card.en, ...card.forms].filter(Boolean)
  const escaped = forms.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'i')
  const match = pattern.exec(card.ctx)
  if (!match) return <>{card.ctx}</>
  return (
    <>
      {card.ctx.slice(0, match.index)}
      <b className="text-[var(--tg-theme-text-color,#000)]">{match[0]}</b>
      {card.ctx.slice(match.index + match[0].length)}
    </>
  )
}

/**
 * Карточки слов: очередь к повторению, перевод по пробелу, оценки клавишами
 * 1/2/3. «Не помню» возвращает слово в конец этой же очереди.
 */
export default function ReadingCardsPage() {
  const { ready, cards } = useReading()
  const now = useNow()
  if (!ready) return null
  // Очередь собирается один раз при открытии раздела — дальше её ведёт сам проход.
  return <CardsSession initialQueue={dueQueue(cards, now).map((c) => c.id)} />
}

function CardsSession({ initialQueue }: { initialQueue: string[] }) {
  const { cards, gradeCard, deleteCard, addSession } = useReading()
  const now = useNow()
  const [queue, setQueue] = useState(initialQueue)
  const [shown, setShown] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  const [finished, setFinished] = useState(false)

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  const current = queue.length ? byId.get(queue[0]) : undefined
  const dueCount = dueQueue(cards, now).length

  const grade = async (g: CardGrade) => {
    if (!current) return
    const rest = queue.slice(1)
    const nextQueue = g === 0 ? [...rest, current.id] : rest
    setQueue(nextQueue)
    setShown(false)
    const n = reviewed + 1
    setReviewed(n)
    await gradeCard(current.id, g)
    if (!nextQueue.length && !finished) {
      setFinished(true)
      await addSession({ type: 'cards', lang: 'en', cardsReviewed: n })
    }
  }

  // Клавиатура на десктопе: пробел — перевод, 1/2/3 — оценка.
  const handlers = useLatest({ shown, current, grade, reveal: () => setShown(true) })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input, textarea, select')) return
      const h = handlers.current
      if (!h.current) return
      if (e.key === ' ' && !h.shown) {
        e.preventDefault()
        h.reveal()
      } else if (h.shown && ['1', '2', '3'].includes(e.key)) {
        h.grade((Number(e.key) - 1) as CardGrade)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handlers])

  const remove = async (card: ReadingCard) => {
    if (!(await webAppConfirm(`Удалить слово «${card.en}»?`))) return
    setQueue((q) => q.filter((id) => id !== card.id))
    await deleteCard(card.id)
  }

  const sorted = [...cards].sort((a, b) => a.dueAt.localeCompare(b.dueAt))

  return (
    <>
      <Panel
        title="Карточки слов"
        aside={`${cards.length} ${plural(cards.length, 'слово', 'слова', 'слов')} · к повторению: ${dueCount}`}
      >
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-[var(--tg-theme-bg-color,#f2f2f7)] p-5 text-center">
          {current ? (
            <>
              <div className="flex items-center gap-2">
                <span className="font-[family-name:var(--font-reading)] text-[32px] font-semibold">
                  {current.en}
                </span>
                <button
                  type="button"
                  aria-label="Произнести"
                  onClick={() => speakEnglish(current.en)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-[var(--tg-theme-hint-color,#8e8e93)]"
                >
                  <Volume2 className="h-4 w-4" />
                </button>
              </div>
              {current.ctx ? (
                <p className="max-w-[52ch] font-[family-name:var(--font-reading)] text-[15px] text-[var(--tg-theme-hint-color,#8e8e93)]">
                  <Context card={current} />
                </p>
              ) : null}
              {shown ? (
                <p className="text-[19px]">{current.ru}</p>
              ) : (
                <Btn onClick={() => setShown(true)}>Показать перевод</Btn>
              )}
            </>
          ) : (
            <>
              <p className="text-[18px]">
                {cards.length ? 'На сегодня всё повторено' : 'Карточек пока нет'}
              </p>
              <p className="text-[13px] text-[var(--tg-theme-hint-color,#8e8e93)]">
                {cards.length
                  ? reviewed
                    ? `Повторено: ${reviewed}. Следующие слова появятся по расписанию.`
                    : 'Следующие слова появятся по расписанию повторений.'
                  : 'Откройте «Английский», нажмите на незнакомое слово и добавьте его в карточки.'}
              </p>
            </>
          )}
        </div>
        {current && shown ? (
          <div className="grid grid-cols-3 gap-2">
            <Btn onClick={() => grade(0)}>Не помню</Btn>
            <Btn onClick={() => grade(1)}>С трудом</Btn>
            <Btn variant="primary" onClick={() => grade(2)}>
              Помню
            </Btn>
          </div>
        ) : null}
      </Panel>

      <Panel title="Все слова">
        {sorted.length ? (
          <ul className="flex flex-col">
            {sorted.map((card) => {
              const due = new Date(card.dueAt).getTime()
              return (
                <li
                  key={card.id}
                  className="flex min-w-0 items-center gap-2 border-t border-border py-2 first:border-t-0"
                >
                  <span className="min-w-0 flex-1 truncate text-[14px]">
                    <b>{card.en}</b>
                    <span className="text-[var(--tg-theme-hint-color,#8e8e93)]"> · {card.ru}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--tg-theme-hint-color,#8e8e93)]">
                    {due <= now
                      ? 'сегодня'
                      : new Date(due).toLocaleDateString('ru-RU', {
                          day: '2-digit',
                          month: '2-digit',
                        })}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(card)}
                    aria-label={`Удалить «${card.en}»`}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--tg-theme-hint-color,#8e8e93)]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <Empty>Здесь будет ваш словарь.</Empty>
        )}
      </Panel>
    </>
  )
}
