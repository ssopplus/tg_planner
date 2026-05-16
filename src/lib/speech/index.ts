import { GroqSTTProvider } from './groq'
import { AssemblyAISTTProvider } from './assemblyai'
import { OpenAIWhisperSTTProvider } from './openai-whisper'
import { STTProvider, STTUnavailableError } from './provider'

export type { STTProvider } from './provider'
export { STTUnavailableError } from './provider'

/**
 * Собирает упорядоченный список доступных STT-провайдеров.
 *
 * Порядок:
 * 1. Если задан STT_PROVIDERS (например "groq,assemblyai") — используем его.
 * 2. Иначе — порядок по умолчанию: groq → assemblyai → whisper (legacy).
 * Провайдер включается, только если есть его API-ключ в env.
 */
export function buildSTTChain(): STTProvider[] {
  const order = (process.env.STT_PROVIDERS ?? 'groq,assemblyai,whisper')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  const chain: STTProvider[] = []
  for (const name of order) {
    const provider = createProvider(name)
    if (provider) chain.push(provider)
  }
  return chain
}

function createProvider(name: string): STTProvider | null {
  switch (name) {
    case 'groq': {
      const key = process.env.GROQ_API_KEY
      return key ? new GroqSTTProvider(key) : null
    }
    case 'assemblyai': {
      const key = process.env.ASSEMBLYAI_API_KEY
      return key ? new AssemblyAISTTProvider(key) : null
    }
    case 'whisper': {
      const key = process.env.WHISPER_API_KEY ?? process.env.LLM_API_KEY
      return key ? new OpenAIWhisperSTTProvider(key) : null
    }
    default:
      return null
  }
}

/**
 * Транскрибирует аудио через цепочку провайдеров с автоматическим fallback.
 * Возвращает текст из первого успешного провайдера.
 * Логирует попытки в stdout: `[stt] <name> → ok <ms>ms` / `[stt] <name> failed: <error>`.
 */
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const chain = buildSTTChain()
  if (chain.length === 0) {
    throw new STTUnavailableError(
      'Не настроен ни один STT-провайдер. Задайте GROQ_API_KEY или ASSEMBLYAI_API_KEY.',
    )
  }

  const errors: string[] = []
  for (const provider of chain) {
    const startedAt = Date.now()
    try {
      const text = await provider.transcribe(audioBuffer)
      const elapsed = Date.now() - startedAt
      console.log(`[stt] ${provider.name} → ok ${elapsed}ms`)
      return text
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[stt] ${provider.name} failed: ${message}`)
      errors.push(`${provider.name}: ${message}`)
    }
  }

  throw new STTUnavailableError(`Все STT-провайдеры упали: ${errors.join(' | ')}`)
}
