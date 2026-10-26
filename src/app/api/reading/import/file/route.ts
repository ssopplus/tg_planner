import { NextRequest, NextResponse } from 'next/server'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { extractFromFile, ImportError, MAX_IMPORT_BYTES } from '@/lib/reading/import/files'
import { describeImport, fileSourceKey, saveImported } from '@/lib/reading/import/save'

/** PDF и большие epub разбираются дольше обычного запроса. */
export const maxDuration = 60

/** POST /api/reading/import/file — книга или документ из Mini App (multipart, поле `file`). */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Файл не пришёл' }, { status: 400 })
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: 'Файл больше 4 МБ' }, { status: 413 })
  }

  try {
    const data = new Uint8Array(await file.arrayBuffer())
    const extracted = await extractFromFile(file.name, data)
    const saved = await saveImported(user.id, {
      ...extracted,
      source: 'file',
      sourceKey: fileSourceKey(data),
    })
    return NextResponse.json({ ...saved, message: describeImport(saved) }, { status: 201 })
  } catch (error) {
    if (error instanceof ImportError) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    console.error('Ошибка импорта файла:', error)
    return NextResponse.json({ error: 'Не удалось прочитать файл' }, { status: 500 })
  }
}
