import { STTProvider, TELEGRAM_VOICE, type AudioFile } from './provider'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

/**
 * Legacy провайдер: OpenAI Whisper API напрямую.
 * Оставлен для обратной совместимости со старым WHISPER_API_KEY.
 */
export class OpenAIWhisperSTTProvider implements STTProvider {
  readonly name = 'whisper'

  constructor(
    private apiKey: string,
    private baseUrl = process.env.WHISPER_BASE_URL ?? DEFAULT_BASE_URL,
  ) {}

  async transcribe(audioBuffer: Buffer, file: AudioFile = TELEGRAM_VOICE): Promise<string> {
    const formData = new FormData()
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: file.mime })
    formData.append('file', blob, file.name)
    formData.append('model', 'whisper-1')
    formData.append('language', 'ru')

    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    })

    if (!response.ok) {
      throw new Error(`OpenAI Whisper error: ${response.status} ${await response.text()}`)
    }

    const data = (await response.json()) as { text?: string }
    return data.text ?? ''
  }
}
