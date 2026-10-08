/**
 * Разбор описания задачи Яндекс.Трекера в блоки для отрисовки.
 *
 * Трекер хранит описание в своём диалекте Markdown (YFM), и на экране задачи
 * он показан размеченным. В Mini App раньше весь текст шёл одним абзацем:
 * `### Контекст` и `* пункт` читались как есть, и длинный баг-репорт
 * превращался в сплошное полотно.
 *
 * Поддерживаются блоки: заголовки, абзацы, списки (маркированные и
 * нумерованные), цитаты, блоки кода, горизонтальная черта, картинки.
 * Строчно: `**жирный**`, `*курсив*`, `` `код` ``, `~~зачёркнутый~~`,
 * ссылки.
 *
 * Чего нет: таблиц, вложенных списков глубже одного уровня и
 * `%%Tracker-макросов%%` — в описаниях задач они не встречались. Добавлять
 * по реальным примерам, а не на всякий случай.
 */

export interface ImageBlock {
  type: 'image'
  src: string
  alt: string
  width: number | null
  height: number | null
}

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'bold'; children: Inline[] }
  | { type: 'italic'; children: Inline[] }
  | { type: 'strike'; children: Inline[] }

export interface HeadingBlock {
  type: 'heading'
  level: 1 | 2 | 3 | 4 | 5 | 6
  children: Inline[]
}

export interface ParagraphBlock {
  type: 'paragraph'
  children: Inline[]
}

export interface ListBlock {
  type: 'list'
  ordered: boolean
  items: Inline[][]
}

export interface QuoteBlock {
  type: 'quote'
  children: Inline[]
}

export interface CodeBlock {
  type: 'code'
  value: string
}

export interface RuleBlock {
  type: 'rule'
}

export type Block =
  | ImageBlock
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | QuoteBlock
  | CodeBlock
  | RuleBlock

const IMG_RE = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+=(\d+)x(\d+))?\)/g

/** Вложение Трекера переписываем на наш прокси: `<img>` не шлёт заголовки. */
function rewriteAttachmentUrl(url: string, taskKey: string): string {
  const m = url.match(/\/(?:ajax\/)?v2\/attachments\/(\d+)/)
  return m ? `/api/tracker/attachment/${taskKey}/${m[1]}` : url
}

/** Паттерны строчной разметки; порядок важен — побеждает самый левый. */
const INLINE_PATTERNS: Array<{
  re: RegExp
  build: (m: RegExpExecArray) => Inline
}> = [
  // Код первым: внутри него разметка не работает, и `**` там буквальные.
  { re: /`([^`]+)`/, build: (m) => ({ type: 'code', value: m[1] }) },
  {
    re: /\[([^\]]+)\]\(([^)\s]+)\)/,
    build: (m) => ({ type: 'link', href: m[2], children: parseInline(m[1]) }),
  },
  {
    re: /\*\*([^*]+)\*\*/,
    build: (m) => ({ type: 'bold', children: parseInline(m[1]) }),
  },
  {
    re: /__([^_]+)__/,
    build: (m) => ({ type: 'bold', children: parseInline(m[1]) }),
  },
  {
    re: /~~([^~]+)~~/,
    build: (m) => ({ type: 'strike', children: parseInline(m[1]) }),
  },
  {
    re: /(?<![*\w])\*([^*\n]+)\*(?!\*)/,
    build: (m) => ({ type: 'italic', children: parseInline(m[1]) }),
  },
  {
    re: /(?<![_\w])_([^_\n]+)_(?!_)/,
    build: (m) => ({ type: 'italic', children: parseInline(m[1]) }),
  },
]

/**
 * Разбирает строчную разметку.
 *
 * На каждом шаге ищем самое левое совпадение среди всех паттернов, а не
 * прогоняем их по очереди: иначе `**жирный с [ссылкой](u)**` развалился бы,
 * потому что ссылка нашлась бы раньше и разрезала жирный пополам.
 */
export function parseInline(text: string): Inline[] {
  if (!text) return []

  let best: { index: number; match: RegExpExecArray; build: (m: RegExpExecArray) => Inline } | null =
    null

  for (const { re, build } of INLINE_PATTERNS) {
    const m = re.exec(text)
    if (!m) continue
    if (!best || m.index < best.index) best = { index: m.index, match: m, build }
  }

  if (!best) return [{ type: 'text', value: text }]

  const before = text.slice(0, best.index)
  const after = text.slice(best.index + best.match[0].length)
  return [
    ...(before ? [{ type: 'text' as const, value: before }] : []),
    best.build(best.match),
    ...parseInline(after),
  ]
}

/** Вытаскивает картинки отдельными блоками, остальное отдаёт текстом. */
function splitImages(text: string, taskKey: string): { text: string; images: ImageBlock[] } {
  const images: ImageBlock[] = []
  const rest = text.replace(IMG_RE, (_full, alt: string, src: string, w?: string, h?: string) => {
    images.push({
      type: 'image',
      src: rewriteAttachmentUrl(src, taskKey),
      alt,
      width: w ? Number(w) : null,
      height: h ? Number(h) : null,
    })
    return ''
  })
  return { text: rest, images }
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const BULLET_RE = /^\s*[*+-]\s+(.*)$/
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/
const QUOTE_RE = /^\s*>\s?(.*)$/
const RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const FENCE_RE = /^\s*```/

/** Разбирает описание задачи в список блоков. */
export function parseDescription(text: string, taskKey: string): Block[] {
  const normalized = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const blocks: Block[] = []

  // Накопитель обычного абзаца: строки до пустой строки или до другого блока.
  let paragraph: string[] = []
  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const joined = paragraph.join('\n').trim()
    paragraph = []
    if (!joined) return
    const { text: rest, images } = splitImages(joined, taskKey)
    const inline = parseInline(rest.trim())
    if (inline.length > 0 && rest.trim()) blocks.push({ type: 'paragraph', children: inline })
    blocks.push(...images)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (FENCE_RE.test(line)) {
      flushParagraph()
      const body: string[] = []
      i++
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      blocks.push({ type: 'code', value: body.join('\n') })
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      continue
    }

    if (RULE_RE.test(line)) {
      flushParagraph()
      blocks.push({ type: 'rule' })
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading) {
      flushParagraph()
      const { text: rest, images } = splitImages(heading[2], taskKey)
      blocks.push({
        type: 'heading',
        level: heading[1].length as HeadingBlock['level'],
        children: parseInline(rest.trim()),
      })
      blocks.push(...images)
      continue
    }

    const quote = QUOTE_RE.exec(line)
    if (quote) {
      flushParagraph()
      const body = [quote[1]]
      while (i + 1 < lines.length && QUOTE_RE.test(lines[i + 1])) {
        body.push(QUOTE_RE.exec(lines[i + 1])![1])
        i++
      }
      blocks.push({ type: 'quote', children: parseInline(body.join('\n').trim()) })
      continue
    }

    const bullet = BULLET_RE.exec(line)
    const ordered = ORDERED_RE.exec(line)
    if (bullet || ordered) {
      flushParagraph()
      const isOrdered = Boolean(ordered)
      const items: Inline[][] = []
      const images: ImageBlock[] = []

      let current: RegExpExecArray | null = bullet ?? ordered
      while (current) {
        const { text: rest, images: inImages } = splitImages(current[1], taskKey)
        items.push(parseInline(rest.trim()))
        images.push(...inImages)

        const next = lines[i + 1]
        if (next === undefined) break
        const nextMatch = isOrdered ? ORDERED_RE.exec(next) : BULLET_RE.exec(next)
        if (!nextMatch) break
        i++
        current = nextMatch
      }

      blocks.push({ type: 'list', ordered: isOrdered, items })
      blocks.push(...images)
      continue
    }

    paragraph.push(line)
  }

  flushParagraph()
  return blocks
}
