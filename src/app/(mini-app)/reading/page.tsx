'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { useReading } from '@/components/reading/reading-provider'
import { ProgressChart } from '@/components/reading/progress-chart'
import { Empty, Panel, Stat, Tip } from '@/components/reading/ui'
import { useNow } from '@/components/reading/use-now'
import { dueQueue } from '@/lib/reading/srs'
import {
  dailyPlan,
  dailyTip,
  dayKey,
  formatDuration,
  lastTest,
  plural,
  streak,
} from '@/lib/reading/stats'
import type { ReadingSession } from '@/lib/reading/types'

const SESSION_LABEL: Record<ReadingSession['type'], string> = {
  rsvp: 'Разминка',
  pacer: 'Указка',
  silent: 'Без голоса',
  test: 'Тест',
  cards: 'Карточки',
  read_en: 'Чтение EN',
}

function sessionDetail(s: ReadingSession): string {
  switch (s.type) {
    case 'cards': {
      const n = s.cardsReviewed ?? 0
      return `${n} ${plural(n, 'слово', 'слова', 'слов')}`
    }
    case 'read_en':
      return s.wordsSaved ? `+${s.wordsSaved} в карточки` : ''
    case 'test':
      return `${s.wpm} слов/мин · ${s.comp}%`
    case 'silent':
      return formatDuration(s.ms ?? 0)
    default:
      return `${s.wpm} слов/мин · ${formatDuration(s.ms ?? 0)}`
  }
}

/** «Сегодня»: плитки прогресса, план дня с автоотметками, подсказка темпа, график и лента. */
export default function ReadingTodayPage() {
  const { ready, lang, sessions, cards } = useReading()
  const now = useNow()
  const today = dayKey(new Date(now))

  const stats = useMemo(() => {
    const tests = sessions.filter((s) => s.type === 'test' && s.lang === lang)
    const last = lastTest(sessions, lang)
    const due = dueQueue(cards, now).length
    const plan = dailyPlan(due, cards.length)
    const doneTypes = new Set(sessions.filter((s) => s.day === today).map((s) => s.type))
    const doneCount = plan.filter((p) => doneTypes.has(p.type)).length
    return {
      tests,
      last,
      plan,
      doneTypes,
      doneCount,
      streak: streak(
        sessions.map((s) => s.day),
        today,
      ),
      recent: [...sessions].reverse().slice(0, 8),
      tip: dailyTip({ lang, last, planDone: doneCount === plan.length }),
    }
  }, [sessions, cards, lang, today, now])

  return (
    <>
      <div className="mx-4 grid grid-cols-2 gap-2">
        <Stat value={stats.last?.wpm ?? '—'} label="слов/мин, последний тест" />
        <Stat value={stats.last ? `${stats.last.comp}%` : '—'} label="понимание" />
        <Stat
          value={stats.streak}
          label={plural(stats.streak, 'день подряд', 'дня подряд', 'дней подряд')}
        />
        <Stat value={sessions.length} label="тренировок всего" />
      </div>

      <Panel
        title="План на сегодня · ~20 минут"
        aside={`${stats.doneCount} из ${stats.plan.length}`}
      >
        <ul className="flex flex-col">
          {stats.plan.map((item) => {
            const done = stats.doneTypes.has(item.type)
            return (
              <li
                key={item.type}
                className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 border-t border-border py-2.5 first:border-t-0"
              >
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full border-2 ${
                    done
                      ? 'border-[var(--color-success,#34c759)] bg-[var(--color-success,#34c759)] text-white'
                      : 'border-border text-transparent'
                  }`}
                  aria-label={done ? 'сделано' : 'не сделано'}
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-[var(--tg-theme-text-color,#000)]">
                    {item.title}
                  </span>
                  <span className="block text-[12px] text-[var(--tg-theme-hint-color,#8e8e93)]">
                    {item.hint}
                  </span>
                </span>
                <Link
                  href={`/reading/${item.section}`}
                  className="rounded-lg bg-[var(--tg-theme-secondary-bg-color,#efeff4)] px-3 py-1.5 text-[13px] font-medium text-[var(--tg-theme-text-color,#000)]"
                >
                  {done ? 'Ещё раз' : 'Начать'}
                </Link>
              </li>
            )
          })}
        </ul>
        {ready ? <Tip>{stats.tip}</Tip> : null}
      </Panel>

      <Panel title={`Скорость и понимание · ${lang.toUpperCase()}`}>
        {stats.tests.length ? (
          <ProgressChart tests={stats.tests} />
        ) : (
          <Empty>После первого теста здесь появится график скорости и понимания.</Empty>
        )}
      </Panel>

      <Panel title="Последние тренировки">
        {stats.recent.length ? (
          <ul className="flex flex-col text-[13px]">
            {stats.recent.map((s) => {
              const at = new Date(s.createdAt)
              return (
                <li
                  key={s.id}
                  className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 border-t border-border py-2 first:border-t-0"
                >
                  <span className="pt-0.5 font-mono text-[11px] text-[var(--tg-theme-hint-color,#8e8e93)]">
                    {at.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}{' '}
                    {at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="min-w-0">
                    <span className="text-[var(--tg-theme-text-color,#000)]">
                      {SESSION_LABEL[s.type]}
                      {s.lang === 'en' && s.type !== 'cards' && s.type !== 'read_en' ? ' EN' : ''}
                    </span>
                    {s.title ? (
                      <span className="text-[var(--tg-theme-hint-color,#8e8e93)]">
                        {' '}
                        · {s.title}
                      </span>
                    ) : null}
                    <span className="block font-mono text-[12px] tabular-nums text-[var(--tg-theme-hint-color,#8e8e93)]">
                      {sessionDetail(s)}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <Empty>Здесь появятся ваши тренировки.</Empty>
        )}
      </Panel>
    </>
  )
}
