/**
 * Разбиение отрисованного текста на визуальные строки для указки: слова с
 * одинаковым `offsetTop` (с допуском в несколько пикселей) — одна строка.
 */

export interface WordBox {
  top: number
  left: number
  width: number
  height: number
}

export interface VisualLine {
  top: number
  height: number
  left: number
  right: number
  /** Индексы слов в исходном массиве. */
  words: number[]
}

/** Допуск по вертикали: у слов с разными шрифтами в строке `offsetTop` расходится на пару пикселей. */
const LINE_TOLERANCE_PX = 4

export function groupLines(boxes: WordBox[]): VisualLine[] {
  const lines: VisualLine[] = []
  let current: VisualLine | null = null
  boxes.forEach((box, index) => {
    if (!current || Math.abs(box.top - current.top) > LINE_TOLERANCE_PX) {
      current = {
        top: box.top,
        height: box.height,
        left: box.left,
        right: box.left + box.width,
        words: [index],
      }
      lines.push(current)
    } else {
      current.words.push(index)
      current.left = Math.min(current.left, box.left)
      current.right = Math.max(current.right, box.left + box.width)
      current.height = Math.max(current.height, box.height)
    }
  })
  return lines
}

/** Время на строку = слова в строке / темп. */
export function lineDurationMs(wordsInLine: number, wpm: number): number {
  if (wpm <= 0) return 0
  return (wordsInLine * 60_000) / wpm
}
