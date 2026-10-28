import { NextRequest, NextResponse } from 'next/server'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { buildSTTChain, transcribeAudio } from '@/lib/speech'

/** Тело запроса у Vercel ограничено 4,5 МБ; запись в Mini App обрезается на 3 минутах. */
const MAX_BYTES = 4_000_000

/** Расширение по типу записи: Whisper-совместимые API определяют формат по имени файла. */
const EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
}

/**
 * POST /api/cockpit/transcribe — голос для сообщения в сессию Claude Code.
 *
 * Mini App записывает голос и присылает сырые байты с типом записи в
 * Content-Type; в ответ — распознанный текст. В сессию он не уходит: текст
 * ложится в поле ввода, его можно поправить и отправить обычным сообщением.
 */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!buildSTTChain().length) return NextResponse.json({ error: 'Распознавание речи не настроено' }, { status: 503 })

  const mime = (request.headers.get('content-type') ?? '').split(';')[0].trim()
  const ext = EXT[mime]
  if (!ext) return NextResponse.json({ error: `Формат записи не поддерживается: ${mime || 'неизвестен'}` }, { status: 415 })
  const audio = Buffer.from(await request.arrayBuffer())
  if (!audio.length) return NextResponse.json({ error: 'Пустая запись' }, { status: 400 })
  if (audio.length > MAX_BYTES) return NextResponse.json({ error: 'Запись слишком длинная' }, { status: 413 })

  try {
    const text = (await transcribeAudio(audio, { mime, name: `voice.${ext}` })).trim()
    return NextResponse.json({ text })
  } catch (e) {
    console.error('[cockpit-transcribe]', e)
    return NextResponse.json({ error: 'Не удалось распознать речь' }, { status: 502 })
  }
}
