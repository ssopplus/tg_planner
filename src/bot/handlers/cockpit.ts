import { Context } from 'grammy'
import { BotContext } from '../middleware/user'
import { applyDecision, getRequest, questionsOf, type DecisionInput } from '@/lib/cockpit/requests'
import { outcomeLabel, refreshRequestMessage } from '../services/cockpit-notify'

/**
 * Кнопки под запросами сессий Claude Code (`ck:*`, см. cockpit-notify).
 *
 * Решение только записывается в БД: до сессии его донесёт dev-cockpit
 * следующим синком, обычно за 2–3 секунды. Чужой запрос `applyDecision` не
 * найдёт — фильтр по владельцу внутри.
 */
export async function handleCockpitCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data
  if (!data?.startsWith('ck:')) return false
  const { dbUser } = ctx as BotContext
  const [, action, id, qi, oi] = data.split(':')

  let input: DecisionInput
  if (action === 'a' || action === 'A') input = { behavior: 'allow', always: action === 'A' }
  else if (action === 'd') input = { behavior: 'deny' }
  else if (action === 'q') {
    // Вариант берём из сохранённого вопроса по индексам: метка в callback_data не влезла бы.
    const req = await getRequest(dbUser.id, id)
    const q = req ? questionsOf(req)[Number(qi)] : undefined
    const label = q?.options[Number(oi)]?.label
    if (!q || label === undefined) {
      await ctx.answerCallbackQuery({ text: req ? 'Вариант не найден' : 'Запрос не найден' })
      return true
    }
    input = { answers: { [q.question]: label } }
  } else return false

  const res = await applyDecision(dbUser.id, id, input)
  if (!res.ok) {
    await ctx.answerCallbackQuery({ text: res.error })
    if (res.req) await refreshRequestMessage(res.req, res.req.status === 'pending' ? undefined : '⌛ Уже закрыт')
    return true
  }
  await ctx.answerCallbackQuery({ text: res.complete ? 'Передаю в сессию' : 'Принято, следующий вопрос' })
  await refreshRequestMessage(res.req, res.complete ? outcomeLabel(res.req) : undefined)
  return true
}
