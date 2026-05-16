/**
 * Обёртка совместимости. Реальная логика — в ./index.ts.
 * Старый API принимал apiKey аргументом; новый игнорирует его и берёт ключи из env.
 */
import { transcribeAudio as transcribeViaChain } from './index'

export async function transcribeAudio(audioBuffer: Buffer, _apiKey?: string): Promise<string> {
  return transcribeViaChain(audioBuffer)
}
