import { parseHTML } from 'linkedom'
import { Readability } from '@mozilla/readability'

/**
 * HTML → абзацы текста. Блоки (абзацы, заголовки, пункты списков, цитаты)
 * становятся абзацами через пустую строку — так текст ждут упражнения.
 * Код из `<pre>` выкидываем: читать его на скорость бессмысленно.
 */

const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, figcaption'

function clean(text: string): string {
  return text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

export function htmlToParagraphs(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
  document.querySelectorAll('pre, code, script, style, noscript, svg, table').forEach((el) => {
    // Короткий inline-код внутри абзаца оставляем как текст, блоки кода — убираем.
    if (el.tagName === 'CODE' && el.closest('pre') === null && (el.textContent ?? '').length < 40)
      return
    el.remove()
  })
  const blocks = Array.from(document.querySelectorAll(BLOCKS))
  const paragraphs: string[] = []
  for (const block of blocks) {
    // Вложенные блоки (p внутри li или blockquote) не дублируем.
    if (block.parentElement?.closest(BLOCKS)) continue
    const text = clean(block.textContent ?? '')
    if (text) paragraphs.push(text)
  }
  if (!paragraphs.length) {
    const text = clean(document.body?.textContent ?? '')
    if (text) paragraphs.push(text)
  }
  return paragraphs.join('\n\n')
}

/**
 * Шапка статьи (сложность, время чтения, счётчики, метки) попадает в
 * Readability как короткие абзацы до основного текста — их срезаем.
 */
export function dropLeadingNoise(body: string): string {
  const paragraphs = body.split('\n\n')
  let start = 0
  while (start < Math.min(paragraphs.length - 1, 10) && paragraphs[start].split(/\s+/).length < 5) {
    start++
  }
  return paragraphs.slice(start).join('\n\n')
}

export interface Article {
  title: string
  body: string
}

/** Основной текст статьи со страницы — Readability, как в «режиме чтения» Firefox. */
export function extractArticle(html: string, url: string): Article | null {
  const { document } = parseHTML(html)
  // Readability читает baseURI для относительных ссылок; linkedom его не знает.
  try {
    Object.defineProperty(document, 'baseURI', { value: url })
  } catch {
    // Не страшно: ссылки в тексте нам не нужны.
  }
  const article = new Readability(document as unknown as Document, { charThreshold: 300 }).parse()
  const title = clean(article?.title ?? document.querySelector('title')?.textContent ?? '')
  const body = article?.content ? dropLeadingNoise(htmlToParagraphs(article.content)) : ''
  if (!body) return null
  return { title: title || new URL(url).hostname, body }
}
