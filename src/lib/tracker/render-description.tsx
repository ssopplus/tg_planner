'use client'

/**
 * Отрисовка описания задачи Яндекс.Трекера.
 *
 * Разбор живёт отдельно, в [markdown.ts](./markdown.ts) — он чистый и
 * проверяется без React. Здесь только вывод блоков и единственная вещь,
 * которой нужен браузер: подстановка initData в адреса вложений.
 */
import { useEffect, useState } from 'react'
import { getInitData, whenWebAppReady } from '@/lib/telegram/webapp'
import { parseDescription, type Block, type ImageBlock, type Inline } from './markdown'

/** Размер картинки под ширину контейнера, с сохранением пропорций. */
function fitToContainer(
  width: number | null,
  height: number | null,
  maxWidth: number,
): { width: number; height: number } | null {
  if (!width || !height) return null
  if (width <= maxWidth) return { width, height }
  const ratio = maxWidth / width
  return { width: maxWidth, height: Math.round(height * ratio) }
}

const TEXT = 'text-[var(--tg-theme-text-color,#000)]'
const HINT = 'text-[var(--tg-theme-hint-color,#8e8e93)]'
const ACCENT = 'text-[var(--tg-theme-button-color,#007aff)]'
const SURFACE = 'bg-[var(--tg-theme-secondary-bg-color,#efeff4)]'

/** Размер заголовка по уровню: h1 и h2 в описаниях задач редки, h3 — норма. */
const HEADING_CLASS: Record<number, string> = {
  1: 'text-[17px] font-bold',
  2: 'text-[16px] font-bold',
  3: 'text-[15px] font-semibold',
  4: 'text-[14px] font-semibold',
  5: 'text-[13px] font-semibold',
  6: `text-[13px] font-semibold ${HINT}`,
}

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case 'text':
            return <span key={i}>{node.value}</span>
          case 'code':
            return (
              <code
                key={i}
                className={`rounded px-1 py-0.5 font-mono text-[12px] ${SURFACE} ${TEXT}`}
              >
                {node.value}
              </code>
            )
          case 'link':
            return (
              <a
                key={i}
                href={node.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`${ACCENT} underline`}
              >
                <InlineNodes nodes={node.children} />
              </a>
            )
          case 'bold':
            return (
              <strong key={i} className="font-semibold">
                <InlineNodes nodes={node.children} />
              </strong>
            )
          case 'italic':
            return (
              <em key={i} className="italic">
                <InlineNodes nodes={node.children} />
              </em>
            )
          case 'strike':
            return (
              <s key={i} className={HINT}>
                <InlineNodes nodes={node.children} />
              </s>
            )
        }
      })}
    </>
  )
}

export function TrackerDescription({
  text,
  taskKey,
  maxImageWidth = 320,
}: {
  text: string
  taskKey: string
  maxImageWidth?: number
}) {
  const blocks = parseDescription(text, taskKey)

  // <img src> не умеет слать заголовки, поэтому initData идёт query-параметром.
  // SDK Telegram'а на iOS WKWebView инициализируется чуть позже первого render,
  // поэтому ждём whenWebAppReady() прежде чем подставлять initData в src
  // картинок — иначе первая попытка fetch'а уходит с пустым auth и получает 401.
  // Начальное значение берём сразу: на десктопе SDK обычно уже готов, и
  // лишний проход рендера с пустым auth только мигает битыми картинками.
  const [initData, setInitData] = useState<string | null>(() => getInitData() || null)
  useEffect(() => {
    if (initData) return
    whenWebAppReady().then(() => setInitData(getInitData() || null))
  }, [initData])

  if (blocks.length === 0) return null

  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((block, i) => (
        <BlockView
          key={i}
          block={block}
          initData={initData}
          maxImageWidth={maxImageWidth}
        />
      ))}
    </div>
  )
}

function BlockView({
  block,
  initData,
  maxImageWidth,
}: {
  block: Block
  initData: string | null
  maxImageWidth: number
}) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(block.level + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6'
      return (
        <Tag className={`${HEADING_CLASS[block.level]} ${TEXT} mt-1 leading-snug`}>
          <InlineNodes nodes={block.children} />
        </Tag>
      )
    }

    case 'paragraph':
      return (
        <p className={`text-sm leading-relaxed ${TEXT} whitespace-pre-wrap`}>
          <InlineNodes nodes={block.children} />
        </p>
      )

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag
          className={`flex flex-col gap-1 pl-5 text-sm leading-relaxed ${TEXT} ${
            block.ordered ? 'list-decimal' : 'list-disc'
          }`}
        >
          {block.items.map((item, i) => (
            <li key={i} className="pl-0.5">
              <InlineNodes nodes={item} />
            </li>
          ))}
        </Tag>
      )
    }

    case 'quote':
      return (
        <blockquote
          className={`border-l-2 border-[var(--tg-theme-hint-color,#8e8e93)] pl-3 text-sm leading-relaxed ${HINT} whitespace-pre-wrap`}
        >
          <InlineNodes nodes={block.children} />
        </blockquote>
      )

    case 'code':
      return (
        <pre
          className={`overflow-x-auto rounded-lg p-3 font-mono text-[12px] leading-snug ${SURFACE} ${TEXT}`}
        >
          <code>{block.value}</code>
        </pre>
      )

    case 'rule':
      return <hr className="border-t border-border" />

    case 'image':
      return <ImageView block={block} initData={initData} maxImageWidth={maxImageWidth} />
  }
}

function ImageView({
  block,
  initData,
  maxImageWidth,
}: {
  block: ImageBlock
  initData: string | null
  maxImageWidth: number
}) {
  const geom = fitToContainer(block.width, block.height, maxImageWidth)
  const isProxied = block.src.startsWith('/api/tracker/attachment/')
  const ready = !isProxied || initData !== null
  const authQuery = initData ? `?initData=${encodeURIComponent(initData)}` : ''
  const src = isProxied ? `${block.src}${authQuery}` : block.src

  return (
    <a
      href={ready ? src : undefined}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-block max-w-full overflow-hidden rounded-lg ${SURFACE}`}
      style={geom ? { width: geom.width } : undefined}
    >
      {ready ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={block.alt}
          width={geom?.width}
          height={geom?.height}
          loading="lazy"
          className="block h-auto max-w-full"
        />
      ) : (
        // Заглушка пока ждём initData — чтобы <img> не делал первый fetch
        // с пустым auth и не уходил в broken-image-кеш браузера.
        <div
          style={geom ? { width: geom.width, height: geom.height } : undefined}
          className="block max-w-full"
        />
      )}
    </a>
  )
}
