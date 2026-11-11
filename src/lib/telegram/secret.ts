import crypto from 'crypto'

/**
 * Сравнение секретов за постоянное время: обычное `===` выходит на первом
 * несовпавшем символе, и по времени ответа секрет можно подбирать посимвольно.
 * Строки сначала хэшируются, чтобы длина тоже не утекала.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

/**
 * Проверка `Authorization: Bearer <secret>`. Пустой или незаданный секрет —
 * всегда отказ: иначе `Bearer ${undefined}` пропускал заголовок «Bearer undefined».
 */
export function checkBearer(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false
  return safeEqual(header, `Bearer ${secret}`)
}
