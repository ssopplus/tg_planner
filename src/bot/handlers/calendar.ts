import { Context } from 'grammy'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { calendarEvents } from '@/lib/db/schema'
import { BotContext } from '../middleware/user'
import { caldavConfig, getObject, putEvent } from '@/lib/calendar/caldav'
import { setPartstat } from '@/lib/calendar/ics'
import { answerLine, PARTSTAT_BY_CODE } from '../services/calendar-notify'
import { partstatLabel } from '@/lib/calendar/format'

/**
 * Ответ на приглашение кнопкой под сообщением.
 *
 * Формат callback_data: `cal:<y|n|m>:<id записи зеркала>` — вместе с uuid это
 * 42 байта из разрешённых 64.
 *
 * Ответ пишется прямо в Яндекс.Календарь: событие перечитывается по своему
 * адресу, в строке ATTENDEE с моим адресом меняется PARTSTAT, и объект
 * возвращается на сервер. Рассылку ответа организатору делает сам Яндекс,
 * если у установки включено авто-планирование (`pnpm caldav:check` это
 * печатает).
 */
export async function handleCalendarCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data
  if (!data?.startsWith('cal:')) return false

  const [, code, id] = data.split(':')
  const partstat = PARTSTAT_BY_CODE[code]
  if (!partstat || !id) {
    await ctx.answerCallbackQuery({ text: 'Непонятный ответ' })
    return true
  }

  const { dbUser } = ctx as BotContext
  const [event] = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, dbUser.id)))
    .limit(1)

  if (!event) {
    await ctx.answerCallbackQuery({ text: 'Встреча уже не в списке' })
    return true
  }

  const config = caldavConfig()
  if (!config) {
    await ctx.answerCallbackQuery({ text: 'Календарь не подключён' })
    return true
  }

  try {
    const object = await getObject(config, event.href)
    if (!object) {
      await ctx.answerCallbackQuery({ text: 'Встречи больше нет в Календаре' })
      return true
    }

    const patched = setPartstat(object.ics, config.email, partstat)
    if (!patched) {
      await ctx.answerCallbackQuery({ text: 'Меня нет в списке участников — отвечать не за кого' })
      return true
    }

    const result = await putEvent(config, event.href, object.etag, patched)
    if (!result.ok) {
      await ctx.answerCallbackQuery({ text: `Календарь не принял ответ: ${result.reason ?? result.status}` })
      return true
    }

    await db
      .update(calendarEvents)
      .set({ partstat, etag: null })
      .where(eq(calendarEvents.id, event.id))

    const original = ctx.callbackQuery?.message?.text ?? event.summary
    await ctx.editMessageText(`${original}\n\n${answerLine(partstat)}`)
    await ctx.answerCallbackQuery({ text: partstatLabel(partstat) })
  } catch (error) {
    console.error('Ошибка ответа на приглашение:', error)
    await ctx.answerCallbackQuery({ text: 'Календарь недоступен, попробуй позже' })
  }

  return true
}
