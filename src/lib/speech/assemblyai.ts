import { STTProvider } from './provider'

const ASSEMBLY_BASE_URL = 'https://api.assemblyai.com/v2'
const POLL_INTERVAL_MS = 1000
const POLL_TIMEOUT_MS = 60_000

/**
 * AssemblyAI Universal-2. Резервный STT-провайдер.
 * Двухступенчатый API: upload → request transcript → poll.
 * Латентность 1-3с на короткие аудио.
 */
export class AssemblyAISTTProvider implements STTProvider {
  readonly name = 'assemblyai'

  constructor(
    private apiKey: string,
    private baseUrl = ASSEMBLY_BASE_URL,
  ) {}

  async transcribe(audioBuffer: Buffer): Promise<string> {
    const uploadUrl = await this.upload(audioBuffer)
    const transcriptId = await this.requestTranscript(uploadUrl)
    return await this.pollTranscript(transcriptId)
  }

  private async upload(audioBuffer: Buffer): Promise<string> {
    const response = await fetch(`${this.baseUrl}/upload`, {
      method: 'POST',
      headers: {
        authorization: this.apiKey,
        'content-type': 'application/octet-stream',
      },
      body: new Uint8Array(audioBuffer),
    })
    if (!response.ok) {
      throw new Error(`AssemblyAI upload error: ${response.status} ${await response.text()}`)
    }
    const data = (await response.json()) as { upload_url: string }
    return data.upload_url
  }

  private async requestTranscript(audioUrl: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/transcript`, {
      method: 'POST',
      headers: {
        authorization: this.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        language_code: 'ru',
        speech_model: 'universal',
      }),
    })
    if (!response.ok) {
      throw new Error(
        `AssemblyAI transcript create error: ${response.status} ${await response.text()}`,
      )
    }
    const data = (await response.json()) as { id: string }
    return data.id
  }

  private async pollTranscript(transcriptId: string): Promise<string> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      const response = await fetch(`${this.baseUrl}/transcript/${transcriptId}`, {
        headers: { authorization: this.apiKey },
      })
      if (!response.ok) {
        throw new Error(`AssemblyAI poll error: ${response.status} ${await response.text()}`)
      }
      const data = (await response.json()) as {
        status: 'queued' | 'processing' | 'completed' | 'error'
        text?: string
        error?: string
      }
      if (data.status === 'completed') return data.text ?? ''
      if (data.status === 'error') throw new Error(`AssemblyAI transcript error: ${data.error}`)
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }
    throw new Error('AssemblyAI poll timeout')
  }
}
