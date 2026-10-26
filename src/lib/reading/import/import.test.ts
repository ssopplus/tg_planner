import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { decodeText, extractFromFile, isImportableFile, parseFb2 } from './files'
import { parseHabrRss } from './habr'
import { dropLeadingNoise, htmlToParagraphs } from './html'
import { canonicalUrl, parsePublicUrl } from './url'
import { detectLang } from './save'

describe('fb2', () => {
  it('берёт название и абзацы основного тела, сноски пропускает', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook><description><title-info><book-title>Книга &amp; Ко</book-title></title-info></description>
<body><section><title><p>Глава 1</p></title><p>Первый <emphasis>абзац</emphasis>.</p><p>Второй абзац.</p></section></body>
<body name="notes"><section><p>Сноска</p></section></body></FictionBook>`
    expect(parseFb2(xml)).toEqual({
      title: 'Книга & Ко',
      body: 'Глава 1\n\nПервый абзац.\n\nВторой абзац.',
    })
  })

  it('читает fb2 в windows-1251 по объявленной кодировке', async () => {
    const xml =
      '<?xml version="1.0" encoding="windows-1251"?><FictionBook><body><p>Привет</p></body></FictionBook>'
    // Кириллица в cp1251: «Привет» = CF F0 E8 E2 E5 F2.
    const bytes = new Uint8Array(
      [...xml].flatMap((ch) => {
        const map: Record<string, number> = { П: 0xcf, р: 0xf0, и: 0xe8, в: 0xe2, е: 0xe5, т: 0xf2 }
        return [map[ch] ?? ch.charCodeAt(0)]
      }),
    )
    const result = await extractFromFile('book.fb2', bytes)
    expect(result.body).toBe('Привет')
    expect(result.title).toBe('book')
  })
})

describe('epub', () => {
  it('собирает главы в порядке spine', async () => {
    const zip = new JSZip()
    zip.file(
      'META-INF/container.xml',
      '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    )
    zip.file(
      'OEBPS/content.opf',
      `<package><metadata><dc:title>Test Book</dc:title></metadata>
<manifest><item id="b" href="ch2.xhtml" media-type="application/xhtml+xml"/><item id="a" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="a"/><itemref idref="b"/></spine></package>`,
    )
    zip.file('OEBPS/ch1.xhtml', '<html><body><h1>One</h1><p>First chapter.</p></body></html>')
    zip.file('OEBPS/ch2.xhtml', '<html><body><p>Second chapter.</p></body></html>')
    const data = await zip.generateAsync({ type: 'uint8array' })
    expect(await extractFromFile('book.epub', data)).toEqual({
      title: 'Test Book',
      body: 'One\n\nFirst chapter.\n\nSecond chapter.',
    })
  })
})

describe('кодировки и типы файлов', () => {
  it('битый UTF-8 перечитывается как windows-1251', () => {
    const cp1251 = new Uint8Array(Array.from({ length: 50 }, () => [0xcf, 0xf0, 0xe8]).flat())
    expect(decodeText(cp1251).startsWith('При')).toBe(true)
  })

  it('принимает только поддерживаемые расширения', () => {
    expect(isImportableFile('Книга.FB2.zip')).toBe(true)
    expect(isImportableFile('notes.docx')).toBe(false)
  })
})

describe('HTML и ссылки', () => {
  it('блоки → абзацы, блоки кода выкидываются, вложенные не дублируются', () => {
    const html =
      '<h2>Заголовок</h2><p>Текст с <code>x</code> кодом.</p><pre><code>const a = 1</code></pre><ul><li><p>Пункт</p></li></ul>'
    expect(htmlToParagraphs(html)).toBe('Заголовок\n\nТекст с x кодом.\n\nПункт')
  })

  it('срезает шапку статьи из коротких абзацев', () => {
    expect(dropLeadingNoise('Средний\n\n8 мин\n\n0\n\nОбычно у меня открыто много сессий.')).toBe(
      'Обычно у меня открыто много сессий.',
    )
  })

  it('убирает utm-метки и якорь', () => {
    expect(
      canonicalUrl(new URL('https://habr.com/ru/articles/1/?utm_source=rss&utm_medium=x&page=2#c')),
    ).toBe('https://habr.com/ru/articles/1/?page=2')
  })

  it('не открывает внутренние адреса', () => {
    expect(() => parsePublicUrl('http://localhost:3000')).toThrow()
    expect(() => parsePublicUrl('http://192.168.1.1/x')).toThrow()
    expect(() => parsePublicUrl('file:///etc/passwd')).toThrow()
    expect(parsePublicUrl('https://habr.com/ru/').hostname).toBe('habr.com')
  })
})

describe('RSS Хабра', () => {
  it('разбирает элементы и чистит ссылки', () => {
    const xml = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Статья про Claude Code]]></title>
<link>https://habr.com/ru/articles/1099622/?utm_campaign=1&amp;utm_source=habrahabr</link>
<description><![CDATA[<p>Обычно у меня <b>много</b> сессий.</p>]]></description>
<pubDate>Mon, 26 Oct 2026 13:56:42 GMT</pubDate></item></channel></rss>`
    expect(parseHabrRss(xml, 'хаб ai')).toEqual([
      {
        title: 'Статья про Claude Code',
        url: 'https://habr.com/ru/articles/1099622/',
        publishedAt: '2026-10-26T13:56:42.000Z',
        summary: 'Обычно у меня много сессий.',
        feed: 'хаб ai',
      },
    ])
  })
})

describe('язык текста', () => {
  it('по преобладающим буквам', () => {
    expect(detectLang('Это русский текст про Claude Code и немного кода')).toBe('ru')
    expect(detectLang('This is English with одно слово')).toBe('en')
  })
})
