/**
 * Экран координации в боте: `/coord` и кнопки под ним.
 *
 * Два входа в одну и ту же карточку:
 *  - крон в 17:00 присылает пошаговый опрос по регулярным направлениям;
 *  - команда `/coord [день]` открывает экран дня — что уже списано, с
 *    возможностью добавить запись или поправить существующую.
 *
 * Списанное всегда читается из Трекера, а не из нашей БД: в ту же очередь
 * пишет скилл `/timesheet` и сам человек через веб-интерфейс, поэтому экран
 * по собственным записям бота показывал бы неполный день.
 *
 * Все callback'и имеют вид `coord:<действие>[:<день>[:<направление>[:…]]]`.
 * Ключи направлений в них сокращены до номера (`4` вместо `INTCOORD-4`) —
 * в callback_data всего 64 байта.
 */
import { Context, InlineKeyboard } from 'grammy'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { coordinationPolls } from '@/lib/db/schema'
import { addWorklog, deleteWorklog, updateWorklog } from '@/lib/tracker/client'
import { BotContext } from '../middleware/user'
import {
  ensurePollForDay,
  EXTRA_DIRECTIONS,
  findDirection,
  formatMinutes,
  fromShortId,
  loadDay,
  renderDay,
  renderEditEntry,
  renderEditList,
  renderEditComment,
  renderPickComment,
  renderPickDirection,
  renderPickMinutes,
  presetComment,
  renderPoll,
  submitPoll,
  todayInTz,
  worklogStart,
  type PollRow,
} from '../services/coordination'

/** Сколько ждём текст комментария, прежде чем считать запрос забытым. */
const PENDING_INPUT_TTL_MS = 15 * 60 * 1000

/** Токен и орг Трекера; без них экран координации не работает. */
function trackerEnv(): { token: string; orgId: string } | null {
  const token = process.env.YANDEX_TRACKER_TOKEN
  const orgId = process.env.YANDEX_TRACKER_ORG_ID
  return token && orgId ? { token, orgId } : null
}

async function save(poll: PollRow, patch: Partial<PollRow>): Promise<PollRow> {
  const [updated] = await db
    .update(coordinationPolls)
    .set(patch)
    .where(eq(coordinationPolls.id, poll.id))
    .returning()
  return updated
}

/** Перерисовывает текущую карточку. */
async function paint(
  ctx: Context,
  view: { text: string; keyboard: InlineKeyboard },
): Promise<void> {
  // Пустой InlineKeyboard в grammy — это [[]], а не []: считаем сами кнопки,
  // иначе финальному сообщению прилетит пустая клавиатура вместо снятия кнопок.
  const hasButtons = view.keyboard.inline_keyboard.flat().length > 0
  await ctx.editMessageText(view.text, {
    reply_markup: hasButtons ? view.keyboard : undefined,
  })
}

/** Показывает главный экран дня, перечитав списанное из Трекера. */
async function paintDay(
  ctx: Context,
  day: string,
  env: { token: string; orgId: string },
): Promise<void> {
  const { dbUser } = ctx as BotContext
  const entries = await loadDay(dbUser, day, env)
  await paint(ctx, renderDay(day, entries))
}

/**
 * Опрос, к которому относится нажатая кнопка.
 *
 * Ищем по самому сообщению, а не по сегодняшней дате: опрос приходит вечером,
 * ответить на него могут после полуночи — тогда «сегодня» уже другое, и поиск
 * по дате находил бы не ту строку или ничего.
 */
async function pollForMessage(ctx: Context, userId: string, timezone: string) {
  const messageId = ctx.callbackQuery?.message?.message_id
  if (messageId) {
    const [byMessage] = await db
      .select()
      .from(coordinationPolls)
      .where(
        and(eq(coordinationPolls.userId, userId), eq(coordinationPolls.messageId, messageId)),
      )
    if (byMessage) return byMessage
  }
  const [byDate] = await db
    .select()
    .from(coordinationPolls)
    .where(
      and(eq(coordinationPolls.userId, userId), eq(coordinationPolls.pollDate, todayInTz(timezone))),
    )
  return byDate
}

/**
 * @returns true, если callback относился к координации и уже обработан.
 */
export async function handleCoordinationCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data
  if (!data?.startsWith('coord:')) return false

  const [, action, arg1, arg2, arg3, arg4] = data.split(':')
  const { dbUser } = ctx as BotContext

  const env = trackerEnv()
  if (!env) {
    await ctx.answerCallbackQuery({ text: 'Трекер не настроен' })
    return true
  }

  switch (action) {
    // ——— экран дня ———

    case 'menu': {
      await paintDay(ctx, arg1, env)
      await ctx.answerCallbackQuery()
      return true
    }

    case 'add': {
      await paint(ctx, renderPickDirection(arg1))
      await ctx.answerCallbackQuery()
      return true
    }

    case 'addpick': {
      await paint(ctx, renderPickMinutes(arg1, fromShortId(arg2)))
      await ctx.answerCallbackQuery()
      return true
    }

    case 'addcom': {
      // Минуты выбраны — спрашиваем комментарий.
      await paint(ctx, renderPickComment(arg1, fromShortId(arg2), Number(arg3)))
      await ctx.answerCallbackQuery()
      return true
    }

    case 'addset': {
      const issueKey = fromShortId(arg2)
      const minutes = Number(arg3)
      const dir = findDirection(issueKey)
      const comment = presetComment(Number(arg4)) ?? dir?.comment ?? 'Координация'
      await ctx.answerCallbackQuery({ text: 'Списываю…' })

      const res = await addWorklog({
        ...env,
        issueKey,
        minutes,
        comment,
        start: worklogStart(arg1, dbUser.timezone),
      })
      if (!res.ok) {
        await ctx.reply(`⚠️ Не удалось списать ${issueKey}: ${res.reason}`)
        return true
      }
      await paintDay(ctx, arg1, env)
      return true
    }

    case 'addtext': {
      // Ждём комментарий обычным сообщением — контекст кладём в БД.
      const issueKey = fromShortId(arg2)
      await setPendingInput(dbUser.id, arg1, {
        kind: 'comment-new',
        issueKey,
        minutes: Number(arg3),
      })
      const dir = findDirection(issueKey)
      await paint(ctx, {
        text:
          `${dir?.label ?? issueKey}, ${formatMinutes(Number(arg3))} за ${arg1}.\n` +
          'Напиши комментарий сообщением — спишу с ним.',
        keyboard: new InlineKeyboard().text('↩︎ Отмена', `coord:menu:${arg1}`),
      })
      await ctx.answerCallbackQuery()
      return true
    }

    // ——— правка ———

    case 'edit': {
      const entries = await loadDay(dbUser, arg1, env)
      if (entries.length === 0) {
        await ctx.answerCallbackQuery({ text: 'Нечего править' })
        await paintDay(ctx, arg1, env)
        return true
      }
      await paint(ctx, renderEditList(arg1, entries))
      await ctx.answerCallbackQuery()
      return true
    }

    case 'editpick': {
      const worklogId = Number(arg3)
      const entries = await loadDay(dbUser, arg1, env)
      const entry = entries.find((e) => e.worklogId === worklogId)
      if (!entry) {
        await ctx.answerCallbackQuery({ text: 'Запись уже изменилась' })
        await paintDay(ctx, arg1, env)
        return true
      }
      await paint(ctx, renderEditEntry(arg1, entry))
      await ctx.answerCallbackQuery()
      return true
    }

    case 'editcomment': {
      const entries = await loadDay(dbUser, arg1, env)
      const entry = entries.find((e) => e.worklogId === Number(arg3))
      if (!entry) {
        await ctx.answerCallbackQuery({ text: 'Запись уже изменилась' })
        await paintDay(ctx, arg1, env)
        return true
      }
      await paint(ctx, renderEditComment(arg1, entry))
      await ctx.answerCallbackQuery()
      return true
    }

    case 'editcom': {
      const issueKey = fromShortId(arg2)
      const comment = presetComment(Number(arg4))
      if (!comment) {
        await ctx.answerCallbackQuery({ text: 'Неизвестный комментарий' })
        return true
      }
      await ctx.answerCallbackQuery({ text: 'Меняю…' })
      const res = await updateWorklogComment(env, dbUser, arg1, issueKey, Number(arg3), comment)
      if (!res.ok) {
        await ctx.reply(`⚠️ Не удалось изменить комментарий: ${res.reason}`)
        return true
      }
      await paintDay(ctx, arg1, env)
      return true
    }

    case 'editcomtext': {
      const issueKey = fromShortId(arg2)
      await setPendingInput(dbUser.id, arg1, {
        kind: 'comment-edit',
        issueKey,
        worklogId: Number(arg3),
      })
      await paint(ctx, {
        text: 'Напиши новый комментарий сообщением.',
        keyboard: new InlineKeyboard().text('↩︎ Отмена', `coord:menu:${arg1}`),
      })
      await ctx.answerCallbackQuery()
      return true
    }

    case 'editset': {
      const issueKey = fromShortId(arg2)
      await ctx.answerCallbackQuery({ text: 'Меняю…' })
      const res = await updateWorklog({
        ...env,
        issueKey,
        worklogId: Number(arg3),
        minutes: Number(arg4),
      })
      if (!res.ok) {
        await ctx.reply(`⚠️ Не удалось изменить ${issueKey}: ${res.reason}`)
        return true
      }
      await paintDay(ctx, arg1, env)
      return true
    }

    case 'editdel': {
      const issueKey = fromShortId(arg2)
      await ctx.answerCallbackQuery({ text: 'Удаляю…' })
      const res = await deleteWorklog({ ...env, issueKey, worklogId: Number(arg3) })
      if (!res.ok) {
        await ctx.reply(`⚠️ Не удалось удалить запись ${issueKey}: ${res.reason}`)
        return true
      }
      await paintDay(ctx, arg1, env)
      return true
    }

    // ——— пошаговый опрос от крона ———

    default: {
      const poll = await pollForMessage(ctx, dbUser.id, dbUser.timezone)
      if (!poll) {
        await ctx.answerCallbackQuery({ text: 'Опрос устарел — вызови /coord' })
        return true
      }
      return handlePollAction(ctx, poll, action, arg1, env)
    }
  }
}

/** Шаги пошагового опроса: ответ, назад, пропуск дня, добавление, списание. */
async function handlePollAction(
  ctx: Context,
  poll: PollRow,
  action: string,
  param: string,
  env: { token: string; orgId: string },
): Promise<boolean> {
  const { dbUser } = ctx as BotContext

  switch (action) {
    case 'set': {
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
      await paint(ctx, renderPoll(next))
      await ctx.answerCallbackQuery()
      return true
    }

    case 'back': {
      const step = Math.max(0, poll.step - 1)
      const answers = { ...poll.answers }
      delete answers[poll.steps[step]]
      const next = await save(poll, { answers, step, status: 'asking' })
      await paint(ctx, renderPoll(next))
      await ctx.answerCallbackQuery()
      return true
    }

    case 'skipday': {
      const next = await save(poll, { status: 'skipped' })
      await paint(ctx, renderPoll(next))
      await ctx.answerCallbackQuery({ text: 'Ок, сегодня без координации' })
      return true
    }

    case 'restart': {
      const next = await save(poll, { answers: {}, step: 0, status: 'asking' })
      await paint(ctx, renderPoll(next))
      await ctx.answerCallbackQuery()
      return true
    }

    case 'more': {
      const available = EXTRA_DIRECTIONS.filter((d) => !(d.key in poll.answers))
      if (available.length === 0) {
        await ctx.answerCallbackQuery({ text: 'Все направления уже в опросе' })
        return true
      }
      const kb = new InlineKeyboard()
      available.forEach((d, i) => {
        if (i > 0 && i % 2 === 0) kb.row()
        kb.text(d.label, `coord:addstep:${d.key}`)
      })
      kb.row().text('↩︎ Отмена', 'coord:cancelmore')
      await ctx.editMessageText('Какое направление добавить?', { reply_markup: kb })
      await ctx.answerCallbackQuery()
      return true
    }

    case 'addstep': {
      if (!findDirection(param)) {
        await ctx.answerCallbackQuery({ text: 'Неизвестное направление' })
        return true
      }
      const steps = [...poll.steps, param]
      const next = await save(poll, { steps, step: steps.length - 1, status: 'asking' })
      await paint(ctx, renderPoll(next))
      await ctx.answerCallbackQuery()
      return true
    }

    case 'cancelmore': {
      await paint(ctx, renderPoll(poll))
      await ctx.answerCallbackQuery()
      return true
    }

    case 'submit': {
      if (poll.status === 'submitted') {
        await ctx.answerCallbackQuery({ text: 'Уже списано' })
        return true
      }
      await ctx.answerCallbackQuery({ text: 'Списываю…' })

      const { worklogIds, failed } = await submitPoll(poll, dbUser, env)
      await save(poll, {
        // Накапливаем: за день может быть несколько раундов списания.
        worklogIds: { ...poll.worklogIds, ...worklogIds },
        status: 'submitted',
        submittedAt: new Date(),
      })

      // После списания показываем экран дня — с него можно добавить ещё
      // или поправить только что внесённое.
      const entries = await loadDay(dbUser, poll.pollDate, env)
      await paint(ctx, renderDay(poll.pollDate, entries))

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

/** Текст приписки о том, что часть направлений уже списана скиллом. */
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
 * Команда `/coord [день]` — открыть экран координации.
 *
 * День понимает как «вчера», «12.09», «2026-09-12»; без аргумента — сегодня.
 * Экран показывает списанное за день и даёт добавить или поправить записи;
 * если за день не списано ничего, предлагает пройти пошаговый опрос.
 */
export async function handleCoordCommand(ctx: Context): Promise<void> {
  const { dbUser } = ctx as BotContext
  const env = trackerEnv()
  if (!env) {
    await ctx.reply('Трекер не настроен: нет YANDEX_TRACKER_TOKEN / YANDEX_TRACKER_ORG_ID.')
    return
  }

  const arg = (ctx.match as string | undefined)?.trim() ?? ''
  const day = parseDayArg(arg, dbUser.timezone)
  if (!day) {
    await ctx.reply(
      'Не понял день. Примеры: /coord, /coord вчера, /coord 12.09, /coord 2026-09-12',
    )
    return
  }

  const entries = await loadDay(dbUser, day, env)

  if (entries.length === 0) {
    // За день ничего нет — предлагаем пройти опрос, а не пустой экран.
    const created = await ensurePollForDay(dbUser, day, env)
    if (created) {
      const { poll } = created
      const view = renderPoll(poll)
      const message = await ctx.reply(view.text, { reply_markup: view.keyboard })
      await db
        .update(coordinationPolls)
        .set({ chatId: String(message.chat.id), messageId: message.message_id })
        .where(eq(coordinationPolls.id, poll.id))
      return
    }
  }

  const view = renderDay(day, entries)
  await ctx.reply(view.text, { reply_markup: view.keyboard })
}

/**
 * Разбирает аргумент команды в дату (YYYY-MM-DD) в таймзоне пользователя.
 * Возвращает null, если аргумент непонятен.
 */
export function parseDayArg(arg: string, timezone: string, now = new Date()): string | null {
  const today = todayInTz(timezone, now)
  if (!arg) return today

  const lower = arg.toLowerCase()
  if (['сегодня', 'today'].includes(lower)) return today
  if (['вчера', 'yesterday'].includes(lower)) {
    return todayInTz(timezone, new Date(now.getTime() - 24 * 3600_000))
  }
  if (lower === 'позавчера') {
    return todayInTz(timezone, new Date(now.getTime() - 48 * 3600_000))
  }

  // 2026-09-12
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) return arg

  // 12.09 или 12.09.2026
  const m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/.exec(arg)
  if (m) {
    const [, d, mo, y] = m
    const year = y ?? today.slice(0, 4)
    const iso = `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
    return Number.isNaN(new Date(`${iso}T12:00:00Z`).getTime()) ? null : iso
  }

  return null
}

/**
 * Запоминает, что от пользователя ждём текст комментария.
 *
 * Контекст кладём в строку дня: если её ещё нет (например, добавляем время за
 * день, когда опроса не было), заводим пустую — она же потом послужит журналом.
 */
async function setPendingInput(
  userId: string,
  day: string,
  input: NonNullable<PollRow['pendingInput']>,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(coordinationPolls)
    .where(and(eq(coordinationPolls.userId, userId), eq(coordinationPolls.pollDate, day)))

  if (existing) {
    await db
      .update(coordinationPolls)
      .set({ pendingInput: input })
      .where(eq(coordinationPolls.id, existing.id))
    return
  }

  await db
    .insert(coordinationPolls)
    .values({ userId, pollDate: day, steps: [], step: 0, status: 'menu', pendingInput: input })
}

/** Меняет комментарий записи, сохраняя её длительность. */
async function updateWorklogComment(
  env: { token: string; orgId: string },
  user: BotContext['dbUser'],
  day: string,
  issueKey: string,
  worklogId: number,
  comment: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Длительность передаём явно, текущую: так правка комментария заведомо не
  // заденет время, какой бы ни была семантика частичного PATCH у Трекера.
  const entries = await loadDay(user, day, env)
  const entry = entries.find((e) => e.worklogId === worklogId)
  if (!entry) return { ok: false, reason: 'запись не найдена' }

  return updateWorklog({ ...env, issueKey, worklogId, minutes: entry.minutes, comment })
}

/**
 * Текстовый ответ на запрос комментария.
 *
 * Вызывается из общего обработчика сообщений ДО парсера задач: иначе
 * «Обсуждение фикстур» превратилось бы в новую задачу вместо комментария.
 *
 * @returns true, если сообщение было комментарием и уже обработано.
 */
export async function handleCoordinationText(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text?.trim()
  if (!text) return false

  const { dbUser } = ctx as BotContext
  const [waiting] = await db
    .select()
    .from(coordinationPolls)
    .where(
      and(eq(coordinationPolls.userId, dbUser.id), isNotNull(coordinationPolls.pendingInput)),
    )
    .orderBy(desc(coordinationPolls.updatedAt))
    .limit(1)

  const input = waiting?.pendingInput
  if (!waiting || !input) return false

  // Ожидание живёт ограниченное время: забытый запрос не должен молча съедать
  // задачу, которую человек напишет через час.
  if (Date.now() - waiting.updatedAt.getTime() > PENDING_INPUT_TTL_MS) {
    await db
      .update(coordinationPolls)
      .set({ pendingInput: null })
      .where(eq(coordinationPolls.id, waiting.id))
    return false
  }

  const env = trackerEnv()
  if (!env) return false

  const day = waiting.pollDate
  await db
    .update(coordinationPolls)
    .set({ pendingInput: null })
    .where(eq(coordinationPolls.id, waiting.id))

  if (input.kind === 'comment-new') {
    const res = await addWorklog({
      ...env,
      issueKey: input.issueKey,
      minutes: input.minutes ?? 0,
      comment: text,
      start: worklogStart(day, dbUser.timezone),
    })
    if (!res.ok) {
      await ctx.reply(`⚠️ Не удалось списать ${input.issueKey}: ${res.reason}`)
      return true
    }
  } else {
    const res = await updateWorklogComment(
      env,
      dbUser,
      day,
      input.issueKey,
      input.worklogId ?? 0,
      text,
    )
    if (!res.ok) {
      await ctx.reply(`⚠️ Не удалось изменить комментарий: ${res.reason}`)
      return true
    }
  }

  const entries = await loadDay(dbUser, day, env)
  const view = renderDay(day, entries)
  await ctx.reply(view.text, { reply_markup: view.keyboard })
  return true
}
