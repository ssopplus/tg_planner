import JSZip from 'jszip'
import { parseHTML } from 'linkedom'
import { htmlToParagraphs } from './html'

/**
 * Текст из файлов: .txt, .fb2 (и .fb2.zip), .epub, .pdf. Разбор на сервере —
 * один и тот же для загрузки из Mini App и для файла, присланного боту.
 */

export const IMPORT_EXTENSIONS = ['.txt', '.fb2', '.fb2.zip', '.zip', '.epub', '.pdf'] as const

/** Лимит тела запроса Vercel — 4,5 МБ; берём с запасом. */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024

export interface ExtractedText {
  title: string
  body: string
}

export class ImportError extends Error {}

export function isImportableFile(name: string): boolean {
  const lower = name.toLowerCase()
  return IMPORT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function baseName(name: string): string {
  return name
    .replace(/\.(fb2\.zip|fb2|epub|pdf|txt|zip)$/i, '')
    .replace(/[_]+/g, ' ')
    .trim()
}

/** UTF-8, а если в нём битые символы — windows-1251: так до сих пор сохраняют русские .txt и .fb2. */
export function decodeText(buffer: Uint8Array, declared?: string | null): string {
  const label = declared?.toLowerCase()
  if (label && label !== 'utf-8' && label !== 'utf8') {
    try {
      return new TextDecoder(label).decode(buffer)
    } catch {
      // Неизвестная кодировка — пробуем как обычно.
    }
  }
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  const broken = (utf8.match(/�/g) ?? []).length
  if (broken > 10 && broken / utf8.length > 0.001) {
    return new TextDecoder('windows-1251').decode(buffer)
  }
  return utf8
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

/**
 * FB2: название из `<book-title>`, текст — абзацы `<p>` из основного `<body>`
 * (тело со сносками `name="notes"` пропускаем). Регулярки, а не XML-парсер:
 * fb2 из библиотек часто невалиден, а структура абзацев простая.
 */
export function parseFb2(xml: string): ExtractedText {
  const title = decodeEntities(/<book-title>([\s\S]*?)<\/book-title>/i.exec(xml)?.[1] ?? '').trim()
  const bodies = Array.from(xml.matchAll(/<body(\s[^>]*)?>([\s\S]*?)<\/body>/gi))
  const main = bodies.find((m) => !/name\s*=\s*["']notes["']/i.test(m[1] ?? '')) ?? bodies[0]
  if (!main) throw new ImportError('В fb2 нет текста книги')
  const paragraphs = Array.from(main[2].matchAll(/<(p|subtitle|v)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi))
    .map((m) =>
      decodeEntities(m[3].replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
  return { title, body: paragraphs.join('\n\n') }
}

async function parseEpub(buffer: Uint8Array): Promise<ExtractedText> {
  const zip = await JSZip.loadAsync(buffer)
  const container = await zip.file('META-INF/container.xml')?.async('string')
  const opfPath = container && /full-path="([^"]+)"/.exec(container)?.[1]
  if (!opfPath) throw new ImportError('Не похоже на epub: нет container.xml')
  const opf = await zip.file(opfPath)?.async('string')
  if (!opf) throw new ImportError('В epub нет описания книги')
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

  const { document } = parseHTML(opf.replace(/<\?xml[^>]*\?>/, ''))
  const title = (document.querySelector('dc\\:title, title')?.textContent ?? '').trim()
  const manifest = new Map<string, string>()
  document.querySelectorAll('manifest item').forEach((item) => {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    const type = item.getAttribute('media-type') ?? ''
    if (id && href && /html/.test(type)) manifest.set(id, href)
  })
  const order = Array.from(document.querySelectorAll('spine itemref'))
    .map((ref) => manifest.get(ref.getAttribute('idref') ?? ''))
    .filter((href): href is string => Boolean(href))

  const parts: string[] = []
  for (const href of order) {
    const path = decodeURIComponent(dir + href.split('#')[0])
    const html = await zip.file(path)?.async('string')
    if (!html) continue
    const bodyHtml = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html
    const text = htmlToParagraphs(bodyHtml)
    if (text) parts.push(text)
  }
  return { title, body: parts.join('\n\n') }
}

async function parsePdf(buffer: Uint8Array): Promise<ExtractedText> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(buffer)
  const { text } = await extractText(pdf, { mergePages: false })
  const pages = (Array.isArray(text) ? text : [text])
    // Перенос со знаком дефиса в конце строки — склеиваем слово.
    .map((page) => page.replace(/(\p{L})-\n(\p{L})/gu, '$1$2'))
    // Строка, кончающаяся точкой, — вероятный конец абзаца; остальные переносы — продолжение.
    .map((page) => page.replace(/([.!?…:])\n(?=\p{Lu})/gu, '$1\n\n'))
  const body = pages.join('\n\n')
  if (!body.trim()) throw new ImportError('В PDF нет текстового слоя — похоже, это скан')
  return { title: '', body }
}

export async function extractFromFile(name: string, data: Uint8Array): Promise<ExtractedText> {
  if (data.byteLength > MAX_IMPORT_BYTES) {
    throw new ImportError('Файл больше 4 МБ — сожмите в .fb2.zip или разбейте')
  }
  const lower = name.toLowerCase()
  let result: ExtractedText

  if (lower.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(data)
    const inner = Object.values(zip.files).find(
      (f) => !f.dir && isImportableFile(f.name) && !f.name.toLowerCase().endsWith('.zip'),
    )
    if (!inner) throw new ImportError('В архиве нет fb2, epub, pdf или txt')
    return extractFromFile(inner.name, await inner.async('uint8array'))
  } else if (lower.endsWith('.fb2')) {
    const head = new TextDecoder('ascii').decode(data.slice(0, 200))
    const encoding = /encoding=["']([^"']+)["']/i.exec(head)?.[1]
    result = parseFb2(decodeText(data, encoding))
  } else if (lower.endsWith('.epub')) {
    result = await parseEpub(data)
  } else if (lower.endsWith('.pdf')) {
    result = await parsePdf(data)
  } else if (lower.endsWith('.txt')) {
    result = { title: '', body: decodeText(data) }
  } else {
    throw new ImportError('Поддерживаются .txt, .fb2, .fb2.zip, .epub и .pdf')
  }

  return { title: result.title || baseName(name) || 'Без названия', body: result.body }
}
