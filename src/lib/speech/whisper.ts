/**
 * Клиент для OpenAI Whisper API (транскрипция речи).
 * Работает через OpenRouter или напрямую через OpenAI.
 */

const WHISPER_BASE_URL = 'https://api.openai.com/v1'

/**
 * Транскрибирует аудиофайл через Whisper API.
 * @param audioBuffer — OGG/Opus файл от Telegram
 * @param apiKey — OpenAI API key (или OpenRouter)
 */
export async function transcribeAudio(audioBuffer: Buffer, apiKey: string): Promise<string> {
  const formData = new FormData()
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/ogg' })
  formData.append('file', blob, 'voice.ogg')
  formData.append('model', 'whisper-1')
  formData.append('language', 'ru')

  const baseUrl = process.env.WHISPER_BASE_URL ?? WHISPER_BASE_URL
  const whisperKey = process.env.WHISPER_API_KEY ?? apiKey

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${whisperKey}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Whisper API error: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return data.text
}
