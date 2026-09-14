/**
 * Кнопки ежедневного опроса по координации.
 *
 * Все callback'и имеют вид `coord:<действие>[:<параметр>]` и работают с одной
 * строкой `coordination_polls` за сегодняшний день пользователя. Сообщение не
 * пересылается заново, а редактируется — опрос остаётся одной карточкой.
 */
import { Context, InlineKeyboard } from 'grammy'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { coordinationPolls } from '@/lib/db/schema'
import { BotContext } from '../middleware/user'
import {
  ensureTodayPoll,
  EXTRA_DIRECTIONS,
  findDirection,
  formatMinutes,
  renderPoll,
  submitPoll,
  todayInTz,
  type PollRow,
} from '../services/coordination'

/** Перерисовывает карточку опроса под текущее состояние. */
async function repaint(ctx: Context, poll: PollRow): Promise<void> {
  const { text, keyboard } = renderPoll(poll)
  // Пустой InlineKeyboard в grammy — это [[]], а не []: считаем сами кнопки,
  // иначе финальному сообщению прилетит пустая клавиатура вместо снятия кнопок.
  const hasButtons = keyboard.inline_keyboard.flat().length > 0
  await ctx.editMessageText(text, {
    reply_markup: hasButtons ? keyboard : undefined,
  })
}

async function save(poll: PollRow, patch: Partial<PollRow>): Promise<PollRow> {
  const [updated] = await db
    .update(coordinationPolls)
    .set(patch)
    .where(eq(coordinationPolls.id, poll.id))
    .returning()
  return updated
}

/**
 * @returns true, если callback относился к опросу и уже обработан.
 */
export async function handleCoordinationCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data
  if (!data?.startsWith('coord:')) return false

  const [, action, param] = data.split(':')
  const { dbUser } = ctx as BotContext

  const [poll] = await db
    .select()
    .from(coordinationPolls)
    .where(
      and(
        eq(coordinationPolls.userId, dbUser.id),
        eq(coordinationPolls.pollDate, todayInTz(dbUser.timezone)),
      ),
    )

  if (!poll) {
    await ctx.answerCallbackQuery({ text: 'Опрос устарел — дождись следующего' })
    return true
  }

  switch (action) {
    case 'set': {
      // Ответ на текущий шаг: записываем минуты и идём дальше.
      const minutes = Number(param)
      const key = poll.steps[poll.step]
      if (!key || !Number.isFinite(minutes)) {
        await ctx.answerCallbackQuery({ text: 'Шаг уже пройден' })
        return true
      }
      const answers = { ...poll.answers, [key]: minutes }
      const step = poll.step + 1
      const next = await save(poll, {
        answers,
        step,
        status: step >= poll.steps.length ? 'confirming' : 'asking',
      })
      await repaint(ctx, next)
      await ctx.answerCallbackQuery()
      return true
    }

    case 'back': {
      // Шаг назад: снимаем ответ по предыдущему направлению и спрашиваем снова.
      const step = Math.max(0, poll.step - 1)
      const answers = { ...poll.answers }
      delete answers[poll.steps[step]]
      const next = await save(poll, { answers, step, status: 'asking' })
      await repaint(ctx, next)
      await ctx.answerCallbackQuery()
      return true
    }

    case 'skipday': {
      const next = await save(poll, { status: 'skipped' })
      await repaint(ctx, next)
      await ctx.answerCallbackQuery({ text: 'Ок, сегодня без координации' })
      return true
    }

    case 'restart': {
      const next = await save(poll, { answers: {}, step: 0, status: 'asking' })
      await repaint(ctx, next)
      await ctx.answerCallbackQuery()
      return true
    }

    case 'more': {
      // Список нерегулярных направлений; уже отвеченные не предлагаем.
      const available = EXTRA_DIRECTIONS.filter((d) => !(d.key in poll.answers))
      if (available.length === 0) {
        await ctx.answerCallbackQuery({ text: 'Все направления уже в опросе' })
        return true
      }
      const kb = new InlineKeyboard()
      available.forEach((d, i) => {
        kb.text(d.label, `coord:add:${d.key}`)
        if ((i + 1) % 2 === 0) kb.row()
      })
      kb.row().text('↩︎ Отмена', 'coord:cancelmore')
      await ctx.editMessageText('Какое направление добавить?', { reply_markup: kb })
      await ctx.answerCallbackQuery()
      return true
    }

    case 'add': {
      if (!findDirection(param)) {
        await ctx.answerCallbackQuery({ text: 'Неизвестное направление' })
        return true
      }
      // Добавляем шаг в конец и возвращаемся в режим опроса — на него же.
      const steps = [...poll.steps, param]
      const next = await save(poll, { steps, step: steps.length - 1, status: 'asking' })
      await repaint(ctx, next)
      await ctx.answerCallbackQuery()
      return true
    }

    case 'cancelmore': {
      await repaint(ctx, poll)
      await ctx.answerCallbackQuery()
      return true
    }

    case 'submit': {
      const token = process.env.YANDEX_TRACKER_TOKEN
      const orgId = process.env.YANDEX_TRACKER_ORG_ID
      if (!token || !orgId) {
        await ctx.answerCallbackQuery({ text: 'Трекер не настроен' })
        return true
      }
      if (poll.status === 'submitted') {
        await ctx.answerCallbackQuery({ text: 'Уже списано' })
        return true
      }

      await ctx.answerCallbackQuery({ text: 'Списываю…' })
      const { worklogIds, failed } = await submitPoll(poll, dbUser, { token, orgId })
      const next = await save(poll, {
        worklogIds,
        status: 'submitted',
        submittedAt: new Date(),
      })
      await repaint(ctx, next)

      if (failed.length) {
        const lines = failed.map((f) => `• ${f.key}: ${f.reason}`).join('\n')
        await ctx.reply(`⚠️ Не удалось списать:\n${lines}`)
      }
      return true
    }

    default:
      await ctx.answerCallbackQuery({ text: `Неизвестное действие: ${action}` })
      return true
  }
}

/** Текст уведомления о том, что часть направлений уже списана скиллом. */
export function alreadyLoggedNote(alreadyLogged: Record<string, number>): string | null {
  const entries = Object.entries(alreadyLogged)
  if (entries.length === 0) return null
  const parts = entries.map(([key, min]) => {
    const dir = findDirection(key)
    return `${dir?.label ?? key} ${formatMinutes(min)}`
  })
  return `уже списано сегодня: ${parts.join(', ')}`
}

/**
 * Команда `/coord` — прислать опрос по координации вручную.
 *
 * Нужна, когда опрос пропущен, удалён из чата или день нерабочий, а созвоны
 * всё-таки были. Если опрос за сегодня уже есть — присылает его текущее
 * состояние новой карточкой, чтобы не искать старое сообщение в переписке.
 */
export async function handleCoordCommand(ctx: Context): Promise<void> {
  const { dbUser } = ctx as BotContext
  const token = process.env.YANDEX_TRACKER_TOKEN
  const orgId = process.env.YANDEX_TRACKER_ORG_ID
  if (!token || !orgId) {
    await ctx.reply('Трекер не настроен: нет YANDEX_TRACKER_TOKEN / YANDEX_TRACKER_ORG_ID.')
    return
  }

  const created = await ensureTodayPoll(dbUser, { token, orgId })
  if (!created) {
    await ctx.reply('Вся координация за сегодня уже списана в Трекер — спрашивать нечего.')
    return
  }

  const { poll, alreadyLogged } = created
  const { text, keyboard } = renderPoll(poll)
  const note = alreadyLoggedNote(alreadyLogged)
  const message = await ctx.reply(note ? `${text}\n\n(${note})` : text, {
    reply_markup: keyboard.inline_keyboard.flat().length ? keyboard : undefined,
  })

  await db
    .update(coordinationPolls)
    .set({ chatId: String(message.chat.id), messageId: message.message_id })
    .where(eq(coordinationPolls.id, poll.id))
}
