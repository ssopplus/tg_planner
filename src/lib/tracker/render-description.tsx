'use client'

/**
 * Минимальный рендерер description тикета Yandex Tracker.
 *
 * Поддерживается:
 * - картинки `![alt](/ajax/v2/attachments/<id>?inline=true =WxH)`
 *   переписываются на наш прокси `/api/tracker/attachment/<key>/<id>`
 *   с initData в query (<img> не умеет передавать заголовки);
 * - картинки с absolute URL (https://...) остаются как есть;
 * - ссылки `[text](url)` рендерятся как <a target="_blank">;
 * - `&nbsp;` заменяется на пробел;
 * - абзацы через двойной перевод строки.
 *
 * Что НЕ поддерживается: таблицы, code-fences, заголовки, списки,
 * %%Tracker-макросы%%. Добавим точечно по реальным примерам.
 */
import { useEffect, useState } from 'react'
import { getInitData, whenWebAppReady } from '@/lib/telegram/webapp'

export interface TrackerImageBlock {
  type: 'image'
  src: string
  alt: string
  width: number | null
  height: number | null
}

export type TrackerInline =
  | { type: 'text'; value: string }
  | { type: 'link'; text: string; href: string }

export interface TrackerParagraphBlock {
  type: 'paragraph'
  children: TrackerInline[]
}

export type TrackerBlock = TrackerImageBlock | TrackerParagraphBlock

const IMG_RE = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+=(\d+)x(\d+))?\)/g
const LINK_RE = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g

function rewriteAttachmentUrl(url: string, taskKey: string): string {
  const m = url.match(/\/(?:ajax\/)?v2\/attachments\/(\d+)/)
  if (m) return `/api/tracker/attachment/${taskKey}/${m[1]}`
  return url
}

export function parseTrackerDescription(text: string, taskKey: string): TrackerBlock[] {
  const normalized = text.replace(/&nbsp;/g, ' ').replace(/\r\n?/g, '\n')
  const paragraphs = normalized.split(/\n\s*\n/)
  const result: TrackerBlock[] = []

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue

    // Выделяем картинки в block-level узлы, всё прочее — в paragraph.
    const inline: TrackerInline[] = []
    const images: TrackerImageBlock[] = []
    let cursor = 0

    for (const match of trimmed.matchAll(IMG_RE)) {
      const before = trimmed.slice(cursor, match.index ?? 0)
      if (before) inline.push({ type: 'text', value: before })
      images.push({
        type: 'image',
        src: rewriteAttachmentUrl(match[2], taskKey),
        alt: match[1],
        width: match[3] ? Number(match[3]) : null,
        height: match[4] ? Number(match[4]) : null,
      })
      cursor = (match.index ?? 0) + match[0].length
    }
    const tail = trimmed.slice(cursor).trim()
    if (tail) inline.push({ type: 'text', value: tail })

    // Если абзац — это только пробелы/мусор, пропускаем (например `&nbsp;` → " ").
    if (inline.length === 1 && inline[0].type === 'text' && !inline[0].value.trim()) {
      inline.length = 0
    }

    // Внутри текстовых узлов вытаскиваем [text](url).
    const expanded: TrackerInline[] = []
    for (const node of inline) {
      if (node.type !== 'text') {
        expanded.push(node)
        continue
      }
      let pos = 0
      for (const m of node.value.matchAll(LINK_RE)) {
        const before = node.value.slice(pos, m.index ?? 0)
        if (before) expanded.push({ type: 'text', value: before })
        expanded.push({ type: 'link', text: m[1], href: m[2] })
        pos = (m.index ?? 0) + m[0].length
      }
      const linkTail = node.value.slice(pos)
      if (linkTail) expanded.push({ type: 'text', value: linkTail })
    }

    if (expanded.length > 0) {
      result.push({ type: 'paragraph', children: expanded })
    }
    result.push(...images)
  }

  return result
}

interface ImageGeometry {
  width: number
  height: number
}

/**
 * Подгоняет размер картинки под ширину контейнера, сохраняя пропорции.
 * Если width не задан в исходнике — отдаём естественные размеры.
 */
function fitToContainer(
  width: number | null,
  height: number | null,
  maxWidth: number,
): ImageGeometry | null {
  if (!width || !height) return null
  if (width <= maxWidth) return { width, height }
  const ratio = maxWidth / width
  return { width: maxWidth, height: Math.round(height * ratio) }
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
  const blocks = parseTrackerDescription(text, taskKey)

  // <img src> не умеет слать заголовки, поэтому initData идёт query-параметром.
  // SDK Telegram'а на iOS WKWebView инициализируется чуть позже первого render,
  // поэтому ждём whenWebAppReady() прежде чем подставлять initData в src
  // картинок — иначе первая попытка fetch'а уходит с пустым auth и получает 401.
  const [initData, setInitData] = useState<string | null>(null)
  useEffect(() => {
    const immediate = getInitData()
    if (immediate) {
      setInitData(immediate)
      return
    }
    whenWebAppReady().then(() => setInitData(getInitData()))
  }, [])

  if (blocks.length === 0) return null

  const authQuery = initData ? `?initData=${encodeURIComponent(initData)}` : ''
  const withAuth = (src: string) =>
    src.startsWith('/api/tracker/attachment/') ? `${src}${authQuery}` : src

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => {
        if (block.type === 'paragraph') {
          return (
            <p
              key={i}
              className="text-sm leading-relaxed text-[var(--tg-theme-text-color,#000)] whitespace-pre-wrap"
            >
              {block.children.map((node, j) => {
                if (node.type === 'text') return <span key={j}>{node.value}</span>
                return (
                  <a
                    key={j}
                    href={node.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--tg-theme-button-color,#007aff)] underline"
                  >
                    {node.text}
                  </a>
                )
              })}
            </p>
          )
        }
        const geom = fitToContainer(block.width, block.height, maxImageWidth)
        const isProxied = block.src.startsWith('/api/tracker/attachment/')
        const ready = !isProxied || initData !== null
        const authedSrc = withAuth(block.src)
        return (
          <a
            key={i}
            href={ready ? authedSrc : undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg overflow-hidden bg-[var(--tg-theme-secondary-bg-color,#efeff4)] max-w-full"
            style={geom ? { width: geom.width } : undefined}
          >
            {ready ? (
              <img
                src={authedSrc}
                alt={block.alt}
                width={geom?.width}
                height={geom?.height}
                loading="lazy"
                className="block max-w-full h-auto"
              />
            ) : (
              // Заглушка пока ждём initData — чтобы <img> не делал первый
              // fetch с пустым auth и не уходил в broken-image-кеш браузера.
              <div
                style={geom ? { width: geom.width, height: geom.height } : undefined}
                className="block max-w-full"
              />
            )}
          </a>
        )
      })}
    </div>
  )
}
