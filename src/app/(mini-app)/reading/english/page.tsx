'use client'

import { useCallback, useMemo, useState } from 'react'
import { useReading } from '@/components/reading/reading-provider'
import { TextPicker, textLabel } from '@/components/reading/text-picker'
import { Btn, Chip, Empty, Lede, Panel } from '@/components/reading/ui'
import { WordReader, type WordClick } from '@/components/reading/word-reader'
import { WordSheet, type WordQuery } from '@/components/reading/word-sheet'
import { BUILTIN_TEXTS } from '@/lib/reading/builtin'
import { buildSavedSet, normalizeSurface, sentenceAround } from '@/lib/reading/glossary'
import type { CefrLevel, ReadingText } from '@/lib/reading/types'

type LevelFilter = 'all' | CefrLevel

/**
 * Чтение на английском: клик по слову — перевод в контексте и добавление в
 * карточки. Тексты всегда английские, независимо от переключателя RU/EN.
 */
export default function ReadingEnglishPage() {
  const { customTexts, settings, updateSettings } = useReading()
  const [level, setLevel] = useState<LevelFilter>('all')

  const all = useMemo(
    () => [...customTexts, ...BUILTIN_TEXTS].filter((t) => t.lang === 'en'),
    [customTexts],
  )
  const list = all.filter((t) => level === 'all' || t.level === level)
  const text = list.find((t) => t.id === settings.lastText.en) ?? list[0]

  const select = (id: string) => updateSettings({ lastText: { ...settings.lastText, en: id } })

  return (
    <Panel title="Чтение на английском">
      <Lede>
        Нажмите на незнакомое слово — появится перевод в контексте, слово можно добавить в карточки.
        Сохранённые слова подчёркнуты.
      </Lede>
      <div className="flex gap-1.5 overflow-x-auto">
        {(['all', 'B1', 'B2', 'C1'] as const).map((l) => (
          <Chip key={l} active={level === l} onClick={() => setLevel(l)}>
            {l === 'all' ? 'Все' : l}
          </Chip>
        ))}
      </div>
      {text ? (
        <>
          <TextPicker list={list} value={text.id} onChange={select} />
          <EnglishReader key={text.id} text={text} />
        </>
      ) : (
        <Empty>Текстов уровня {level} пока нет. Добавьте свой на вкладке «Тексты».</Empty>
      )}
    </Panel>
  )
}

function EnglishReader({ text }: { text: ReadingText }) {
  const { cards, addSession } = useReading()
  const [query, setQuery] = useState<WordQuery | null>(null)
  const [added, setAdded] = useState(0)
  const [done, setDone] = useState(false)
  const saved = useMemo(() => buildSavedSet(cards), [cards])

  const onWordClick = useCallback(
    (click: WordClick) => {
      const surface = normalizeSurface(click.token)
      if (!surface) return
      setQuery({
        surface,
        sentence: sentenceAround(click.paragraph, click.index),
        glossary: text.glossary,
      })
    },
    [text.glossary],
  )

  const markRead = async () => {
    setDone(true)
    await addSession({
      type: 'read_en',
      lang: 'en',
      textId: text.id,
      title: text.title,
      wordsSaved: added,
    })
  }

  return (
    <>
      <WordReader body={text.body} lang="en" saved={saved} onWordClick={onWordClick} />
      <div className="flex flex-wrap items-center gap-2">
        <Btn variant="primary" onClick={markRead} disabled={done}>
          Прочитано
        </Btn>
        <span className="text-[12px] text-[var(--tg-theme-hint-color,#8e8e93)]">
          {done
            ? added
              ? `Отмечено. В карточки добавлено слов: ${added}.`
              : 'Отмечено. Проверьте понимание в «Тесте» с переключателем EN.'
            : textLabel(text)}
        </span>
      </div>
      {query ? (
        <WordSheet
          key={`${query.surface}:${query.sentence}`}
          query={query}
          saved={saved}
          onClose={() => setQuery(null)}
          onAdded={() => setAdded((n) => n + 1)}
        />
      ) : null}
    </>
  )
}
