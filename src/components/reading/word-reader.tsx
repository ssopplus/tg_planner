'use client'

import { forwardRef, memo, useMemo } from 'react'
import { FUNCTION_WORDS } from '@/lib/reading/builtin'
import { normalizeSurface } from '@/lib/reading/glossary'
import { splitParagraphs, splitWords } from '@/lib/reading/text-utils'
import type { ReadingLang } from '@/lib/reading/types'

export interface WordClick {
  /** Токен как в тексте, с пунктуацией. */
  token: string
  paragraph: string[]
  /** Индекс токена в абзаце. */
  index: number
  element: HTMLElement
}

/** Слово без пунктуации для сверки со списком служебных слов. */
function bare(token: string): string {
  return token.toLowerCase().replace(/[^а-яёa-z]/g, '')
}

/**
 * Текст, разобранный на слова-спаны: по ним указка ищет строки, «Без голоса»
 * приглушает служебные слова, английское чтение ловит клик по слову. Каждый
 * спан несёт `data-w` — сквозной индекс слова в тексте.
 */
export const WordReader = memo(
  forwardRef<
    HTMLDivElement,
    {
      body: string
      lang: ReadingLang
      dimFunctionWords?: boolean
      saved?: Set<string>
      onWordClick?: (click: WordClick) => void
      className?: string
      style?: React.CSSProperties
      children?: React.ReactNode
    }
  >(function WordReader(
    { body, lang, dimFunctionWords, saved, onWordClick, className = '', style, children },
    ref,
  ) {
    const paragraphs = useMemo(() => splitParagraphs(body).map(splitWords), [body])
    const fn = FUNCTION_WORDS[lang]
    let globalIndex = 0

    return (
      <div
        ref={ref}
        className={`relative font-[family-name:var(--font-reading)] text-[18px] leading-[1.75] text-[var(--tg-theme-text-color,#000)] ${className}`}
        style={style}
      >
        {children}
        {paragraphs.map((words, p) => (
          <p key={p} className="relative z-[1] mb-[0.9em] max-w-[62ch]">
            {words.map((token, i) => {
              const index = globalIndex++
              const isFn = fn.has(bare(token))
              const isSaved = lang === 'en' && saved?.has(normalizeSurface(token))
              return (
                <span key={i}>
                  <span
                    data-w={index}
                    onClick={
                      onWordClick
                        ? (e) =>
                            onWordClick({
                              token,
                              paragraph: words,
                              index: i,
                              element: e.currentTarget,
                            })
                        : undefined
                    }
                    className={[
                      'reading-word rounded-[3px]',
                      dimFunctionWords && isFn ? 'opacity-30' : '',
                      onWordClick
                        ? 'cursor-pointer active:bg-[color-mix(in_srgb,var(--tg-theme-button-color,#007aff)_18%,transparent)]'
                        : '',
                      isSaved
                        ? 'underline decoration-[var(--tg-theme-button-color,#007aff)] decoration-2 underline-offset-4'
                        : '',
                    ].join(' ')}
                  >
                    {token}
                  </span>
                  {i < words.length - 1 ? ' ' : null}
                </span>
              )
            })}
          </p>
        ))}
      </div>
    )
  }),
)
