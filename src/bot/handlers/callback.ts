import { Context } from 'grammy'
import { db } from '@/lib/db'
import { tasks, projects, reminders, subtasks } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { getPendingTask, deletePendingTask } from '../services/pending-store'
import { addToMyDay, removeFromMyDay } from '../services/my-day'
import { parseRecurrenceToRRule } from '@/lib/reminders/rrule-parser'
import { BotContext } from '../middleware/user'
import { buildDevTaskPrompt } from '@/lib/prompts/dev-task'

/**
 * Обработчик callback queries от inline-кнопок.
 * Формат data: "action:id" или "action:id:param"
 */
export async function handleCallback(ctx: Context) {
  const data = ctx.callbackQuery?.data
  if (!data) return

  const { dbUser } = ctx as BotContext
  const parts = data.split(':')
  const action = parts[0]
  const id = parts[1]
  const param = parts[2]

  switch (action) {
    case 'confirm': {
      // Подтверждение создания одной задачи
      const pending = await getPendingTask(id)
      if (!pending) {
        await ctx.answerCallbackQuery({ text: 'Задача устарела, создай заново' })
        return
      }

      const task = await createTaskFromPending(id, dbUser.id, pending)
      await ctx.editMessageText(`✅ Задача создана: **${task.title}**`, {
        parse_mode: 'Markdown',
      })
      await ctx.answerCallbackQuery()
      break
    }

    case 'confirm_all': {
      // Подтверждение всех задач (массовое)
      const ids = id.split(',')
      const created: string[] = []

      for (const pendingId of ids) {
        const pending = await getPendingTask(pendingId)
        if (pending) {
          const task = await createTaskFromPending(pendingId, dbUser.id, pending)
          created.push(task.title)
        }
      }

      if (created.length > 0) {
        const list = created.map((t, i) => `${i + 1}. ${t}`).join('\n')
        await ctx.editMessageText(`✅ Создано задач: **${created.length}**\n\n${list}`, {
          parse_mode: 'Markdown',
        })
      } else {
        await ctx.editMessageText('Задачи устарели, создай заново.')
      }
      await ctx.answerCallbackQuery()
      break
    }

    case 'cancel_all': {
      // Отмена всех задач
      const ids = id.split(',')
      for (const pendingId of ids) {
        await deletePendingTask(pendingId)
      }
      await ctx.editMessageText('❌ Создание отменено')
      await ctx.answerCallbackQuery()
      break
    }

    case 'done': {
      // Завершить задачу
      await db
        .update(tasks)
        .set({ status: 'DONE', completedAt: new Date() })
        .where(eq(tasks.id, id))

      // Отменяем активные напоминания
      await db
        .update(reminders)
        .set({ status: 'CANCELLED' })
        .where(eq(reminders.taskId, id))

      await ctx.answerCallbackQuery({ text: '✅ Задача выполнена!' })
      await ctx.editMessageText(
        (ctx.callbackQuery?.message && 'text' in ctx.callbackQuery.message
          ? ctx.callbackQuery.message.text
          : '') + '\n\n✅ Выполнено',
      )
      break
    }

    case 'delete': {
      // Удалить задачу
      await db.delete(tasks).where(eq(tasks.id, id))
      await ctx.answerCallbackQuery({ text: '🗑 Задача удалена' })
      await ctx.editMessageText('🗑 Задача удалена')
      break
    }

    case 'cancel': {
      // Отменить создание
      await deletePendingTask(id)
      await ctx.editMessageText('❌ Создание отменено')
      await ctx.answerCallbackQuery()
      break
    }

    case 'edit': {
      await ctx.answerCallbackQuery({ text: 'Редактирование пока в разработке' })
      break
    }

    case 'snooze': {
      // Отложить напоминание: snooze:taskId:1h или snooze:taskId:1d
      const snoozeDate = new Date()
      if (param === '1h') {
        snoozeDate.setHours(snoozeDate.getHours() + 1)
      } else if (param === '1d') {
        snoozeDate.setDate(snoozeDate.getDate() + 1)
        snoozeDate.setHours(9, 0, 0, 0) // Завтра в 9:00
      }

      await db.insert(reminders).values({
        taskId: id,
        userId: dbUser.id,
        remindAt: snoozeDate,
        type: 'TIME',
      })

      const label = param === '1h' ? 'через 1 час' : 'завтра в 9:00'
      await ctx.answerCallbackQuery({ text: `⏰ Напомню ${label}` })
      await ctx.editMessageText(
        (ctx.callbackQuery?.message && 'text' in ctx.callbackQuery.message
          ? ctx.callbackQuery.message.text
          : '') + `\n\n⏰ Отложено ${label}`,
      )
      break
    }

    case 'reschedule': {
      // Перенос просроченной задачи: reschedule:taskId:today или reschedule:taskId:tomorrow
      const newDeadline = new Date()
      if (param === 'tomorrow') {
        newDeadline.setDate(newDeadline.getDate() + 1)
      }
      newDeadline.setHours(12, 0, 0, 0)

      await db
        .update(tasks)
        .set({
          deadlineAt: newDeadline,
          overdueCount: Number(
            (
              await db.select({ c: tasks.overdueCount }).from(tasks).where(eq(tasks.id, id))
            )[0]?.c ?? 0,
          ) + 1,
        })
        .where(eq(tasks.id, id))

      const label = param === 'today' ? 'сегодня' : 'завтра'
      await ctx.answerCallbackQuery({ text: `📅 Перенесено на ${label}` })
      await ctx.editMessageText(
        (ctx.callbackQuery?.message && 'text' in ctx.callbackQuery.message
          ? ctx.callbackQuery.message.text
          : '') + `\n\n📅 Перенесено на ${label}`,
      )
      break
    }

    case 'myday_add': {
      await addToMyDay(id)
      await ctx.answerCallbackQuery({ text: '☀️ Добавлено в «Мой день»' })
      break
    }

    case 'myday_remove': {
      await removeFromMyDay(id)
      await ctx.answerCallbackQuery({ text: '🚫 Убрано из «Моего дня»' })
      break
    }

    case 'prompt': {
      // Промт для dev-задачи: отправляем отдельным сообщением в <pre>,
      // чтобы можно было длинно копировать на мобиле.
      const [row] = await db
        .select({
          title: tasks.title,
          description: tasks.description,
          deadlineAt: tasks.deadlineAt,
          deadlineType: tasks.deadlineType,
          projectName: projects.name,
          projectSlug: projects.slug,
          projectDescription: projects.description,
          projectTechStack: projects.techStack,
          projectRepoPath: projects.repoPath,
        })
        .from(tasks)
        .leftJoin(projects, eq(tasks.projectId, projects.id))
        .where(and(eq(tasks.id, id), eq(tasks.userId, dbUser.id)))
        .limit(1)

      if (!row) {
        await ctx.answerCallbackQuery({ text: 'Задача не найдена' })
        break
      }

      const taskSubtasks = await db
        .select({ title: subtasks.title, isCompleted: subtasks.isCompleted })
        .from(subtasks)
        .where(eq(subtasks.taskId, id))
        .orderBy(subtasks.sortOrder)

      const prompt = buildDevTaskPrompt({
        task: {
          title: row.title,
          description: row.description,
          deadlineAt: row.deadlineAt,
          deadlineType: row.deadlineType,
          subtasks: taskSubtasks,
        },
        project: {
          name: row.projectName ?? 'Без проекта',
          slug: row.projectSlug,
          description: row.projectDescription,
          techStack: (row.projectTechStack as string[] | null) ?? null,
          repoPath: row.projectRepoPath,
        },
      })

      // HTML <pre> — на длинных промтах нативное копирование в Telegram
      // работает чище, чем Markdown с экранированием.
      const escaped = prompt
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      await ctx.reply(`<pre>${escaped}</pre>`, { parse_mode: 'HTML' })
      await ctx.answerCallbackQuery({ text: '✨ Промт отправлен' })
      break
    }

    default:
      await ctx.answerCallbackQuery()
  }
}

/**
 * Создаёт задачу из pending store, автоматически добавляет напоминание и rrule.
 */
async function createTaskFromPending(
  pendingId: string,
  userId: string,
  pending: {
    projectId: string
    title: string
    description?: string
    priority?: string
    deadlineAt?: Date
    deadlineType?: string
    recurrence?: string
  },
) {
  const [task] = await db
    .insert(tasks)
    .values({
      userId,
      projectId: pending.projectId,
      title: pending.title,
      description: pending.description ?? null,
      priority: (pending.priority as 'LOW' | 'MEDIUM' | 'HIGH') ?? 'MEDIUM',
      deadlineAt: pending.deadlineAt ?? null,
      deadlineType: (pending.deadlineType as 'HARD' | 'SOFT') ?? null,
    })
    .returning()

  await deletePendingTask(pendingId)

  // Автосоздание напоминания для задач с жёстким дедлайном
  if (task.deadlineAt && task.deadlineType === 'HARD') {
    const rruleStr = pending.recurrence
      ? parseRecurrenceToRRule(pending.recurrence, task.deadlineAt)
      : null

    await db.insert(reminders).values({
      taskId: task.id,
      userId,
      remindAt: task.deadlineAt,
      type: 'BEFORE_DEADLINE',
      rrule: rruleStr,
      isRecurring: !!rruleStr,
    })
  }

  // Если есть повторение без жёсткого дедлайна — создаём TIME-напоминание
  if (pending.recurrence && (!task.deadlineType || task.deadlineType !== 'HARD')) {
    const rruleStr = parseRecurrenceToRRule(
      pending.recurrence,
      task.deadlineAt ?? new Date(),
    )
    if (rruleStr) {
      const remindAt = task.deadlineAt ?? new Date()
      await db.insert(reminders).values({
        taskId: task.id,
        userId,
        remindAt,
        type: 'TIME',
        rrule: rruleStr,
        isRecurring: true,
      })
    }
  }

  return task
}
