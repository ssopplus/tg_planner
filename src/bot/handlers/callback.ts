import { Context } from 'grammy'
import { db } from '@/lib/db'
import { tasks, reminders } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { pendingTasks } from '../services/pending-store'
import { BotContext } from '../middleware/user'

/**
 * Обработчик callback queries от inline-кнопок.
 * Формат data: "action:id" или "action:id:param"
 */
export async function handleCallback(ctx: Context) {
  const data = ctx.callbackQuery?.data
  if (!data) return

  const { dbUser } = ctx as BotContext
  const [action, id, param] = data.split(':')

  switch (action) {
    case 'confirm': {
      // Подтверждение создания задачи
      const pending = pendingTasks.get(id)
      if (!pending) {
        await ctx.answerCallbackQuery({ text: 'Задача устарела, создай заново' })
        return
      }

      const [task] = await db
        .insert(tasks)
        .values({
          userId: dbUser.id,
          projectId: pending.projectId,
          title: pending.title,
          description: pending.description ?? null,
          priority: pending.priority ?? 'MEDIUM',
          deadlineAt: pending.deadlineAt ?? null,
          deadlineType: pending.deadlineType ?? null,
        })
        .returning()

      pendingTasks.delete(id)

      // Автосоздание напоминания для задач с жёстким дедлайном
      if (task.deadlineAt && task.deadlineType === 'HARD') {
        await db.insert(reminders).values({
          taskId: task.id,
          userId: dbUser.id,
          remindAt: task.deadlineAt,
          type: 'BEFORE_DEADLINE',
        })
      }

      await ctx.editMessageText(`✅ Задача создана: **${task.title}**`, {
        parse_mode: 'Markdown',
      })
      await ctx.answerCallbackQuery()
      break
    }

    case 'done': {
      // Завершить задачу
      await db
        .update(tasks)
        .set({ status: 'DONE', completedAt: new Date() })
        .where(eq(tasks.id, id))

      await ctx.answerCallbackQuery({ text: '✅ Задача выполнена!' })
      await ctx.editMessageText(ctx.callbackQuery?.message?.text + '\n\n✅ Выполнено')
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
      pendingTasks.delete(id)
      await ctx.editMessageText('❌ Создание отменено')
      await ctx.answerCallbackQuery()
      break
    }

    case 'edit': {
      // Редактирование поля — пока заглушка, будет расширено
      await ctx.answerCallbackQuery({ text: 'Редактирование пока в разработке' })
      break
    }

    default:
      await ctx.answerCallbackQuery()
  }
}
