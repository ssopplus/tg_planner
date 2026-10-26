import { NextRequest, NextResponse } from 'next/server'
import { InputFile } from 'grammy'
import { bot } from '@/bot'
import { authorizeMiniApp } from '@/lib/telegram/auth'
import { buildAnkiTsv, buildBackup } from '@/lib/reading/backup'
import { dayKey } from '@/lib/reading/stats'

/**
 * POST /api/reading/export — резервная копия (JSON) или карточки для Anki
 * (TSV) приходят файлом в чат с ботом. Скачивание прямо из вебвью Telegram
 * ведёт себя по-разному на iOS, Android и Desktop, а файл в чате доступен везде.
 */
export async function POST(request: NextRequest) {
  const user = await authorizeMiniApp(request.headers.get('X-Telegram-Init-Data') ?? '')
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { format } = (await request.json().catch(() => ({}))) as { format?: unknown }
  const day = dayKey(new Date(), user.timezone)
  const chatId = Number(user.telegramId)

  try {
    if (format === 'anki') {
      const tsv = await buildAnkiTsv(user.id)
      await bot.api.sendDocument(
        chatId,
        new InputFile(Buffer.from(tsv, 'utf-8'), `tempo-cards-${day}.txt`),
        {
          caption: 'Карточки для Anki: Файл → Импорт, разделитель — табуляция.',
        },
      )
    } else {
      const backup = await buildBackup(user.id)
      const json = JSON.stringify(backup)
      await bot.api.sendDocument(
        chatId,
        new InputFile(Buffer.from(json, 'utf-8'), `tempo-backup-${day}.json`),
        {
          caption: `Резервная копия «Темпа чтения»: ${backup.texts.length} текстов, ${backup.sessions.length} тренировок, ${backup.cards.length} карточек. Восстановить — «Чтение → Ещё → Восстановить».`,
        },
      )
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Ошибка экспорта:', error)
    return NextResponse.json({ error: 'Не удалось отправить файл в чат' }, { status: 502 })
  }
}
