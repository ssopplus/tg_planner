/**
 * Абстракция Speech-to-Text провайдера.
 *
 * Реализации:
 * - GroqSTTProvider — основной (whisper-large-v3-turbo, ~0.5с)
 * - AssemblyAISTTProvider — fallback (Universal-2)
 * - WhisperSTTProvider — legacy через OpenAI Whisper API
 *
 * Выбор провайдера и порядок fallback — через env-переменные:
 * STT_PROVIDERS=groq,assemblyai (через запятую, в порядке приоритета)
 * Если переменная не задана — порядок определяется наличием ключей в env.
 */

export interface STTProvider {
  /** Короткое имя для логов: "groq", "assemblyai", "whisper" */
  readonly name: string

  /**
   * Транскрибирует аудиобуфер в текст. Бросает ошибку при неудаче.
   * `file` — тип и имя файла: по расширению Whisper-совместимые API понимают формат.
   * По умолчанию — голосовое Telegram (`voice.ogg`); запись из Mini App — webm или mp4.
   */
  transcribe(audioBuffer: Buffer, file?: AudioFile): Promise<string>
}

export interface AudioFile {
  mime: string
  name: string
}

export const TELEGRAM_VOICE: AudioFile = { mime: 'audio/ogg', name: 'voice.ogg' }

export class STTUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'STTUnavailableError'
  }
}
