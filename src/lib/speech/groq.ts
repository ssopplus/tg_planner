import { STTProvider } from './provider'

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
const GROQ_MODEL = 'whisper-large-v3-turbo'

/**
 * Groq Whisper-large-v3-turbo. Самый быстрый STT (~0.5с на 30с аудио), цена ~$0.004 за минуту.
 * Совместим с OpenAI Audio API.
 */
export class GroqSTTProvider implements STTProvider {
  readonly name = 'groq'

  constructor(
    private apiKey: string,
    private model = process.env.GROQ_STT_MODEL ?? GROQ_MODEL,
    private baseUrl = process.env.GROQ_BASE_URL ?? GROQ_BASE_URL,
  ) {}

  async transcribe(audioBuffer: Buffer): Promise<string> {
    const formData = new FormData()
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/ogg' })
    formData.append('file', blob, 'voice.ogg')
    formData.append('model', this.model)
    formData.append('language', 'ru')
    formData.append('response_format', 'json')
    formData.append('temperature', '0')

    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Groq STT error: ${response.status} ${errorText}`)
    }

    const data = (await response.json()) as { text?: string }
    return data.text ?? ''
  }
}
