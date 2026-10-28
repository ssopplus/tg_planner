import { Context } from 'grammy'
import { BotContext } from '../middleware/user'
import { applyDecision, getRequest, questionsOf } from '@/lib/cockpit/requests'
import { CALLBACK_PREFIX, dropNotice } from '@/lib/cockpit/notify'

/**
 * Кнопки напоминания о запросе сессии Claude Code (см. `lib/cockpit/notify.ts`).
 * Решение пишется так же, как из Mini App, — до сессии его доносит cockpit
 * следующим синком. После ответа сообщение удаляется.
 */
export async function handleCockpitCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data
  if (!data?.startsWith(CALLBACK_PREFIX)) return false
  const { dbUser } = ctx as BotContext
  const [, action, id, option] = data.split(':')

  const req = await getRequest(dbUser.id, id)
  if (!req) {
    await ctx.answerCallbackQuery({ text: 'Запрос не найден' })
    return true
  }

  let result
  if (action === 'a') result = await applyDecision(dbUser.id, id, { behavior: 'allow' })
  else if (action === 'd') result = await applyDecision(dbUser.id, id, { behavior: 'deny', message: 'Отклонено в Telegram' })
  else if (action === 'q') {
    const q = questionsOf(req)[0]
    const label = q?.options[Number(option)]?.label
    if (!q || !label) {
      await ctx.answerCallbackQuery({ text: 'Вариант не найден' })
      return true
    }
    result = await applyDecision(dbUser.id, id, { answers: { [q.question]: label } })
  } else {
    await ctx.answerCallbackQuery()
    return true
  }

  if (!result.ok) {
    await ctx.answerCallbackQuery({ text: result.error })
    if (result.req && result.req.status !== 'pending') await dropNotice(result.req)
    return true
  }
  await ctx.answerCallbackQuery({
    text: action === 'd' ? 'Отклонено' : action === 'q' ? 'Ответ отправлен' : 'Разрешено',
  })
  await dropNotice(result.req)
  return true
}
