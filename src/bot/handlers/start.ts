import { Context } from 'grammy'
import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { BotContext } from '../middleware/user'

/**
 * /start — приветствие, создание дефолтного проекта "Входящие"
 */
export async function handleStart(ctx: Context) {
  const { dbUser } = ctx as BotContext

  // Создаём проект "Входящие", если его ещё нет
  const [existing] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, dbUser.id), eq(projects.isDefault, true)))
    .limit(1)

  if (!existing) {
    await db.insert(projects).values({
      userId: dbUser.id,
      name: 'Входящие',
      isDefault: true,
    })
  }

  await ctx.reply(
    `Привет, ${dbUser.firstName ?? 'друг'}! 👋\n\n` +
      'Я помогу тебе управлять задачами. Просто напиши задачу текстом, и я разберу её.\n\n' +
      '**Примеры:**\n' +
      '• "купить молоко завтра 18:00"\n' +
      '• "позвонить маме в пятницу"\n' +
      '• "сдать отчёт до 5 марта"\n\n' +
      '**Команды:**\n' +
      '/tasks — список задач\n' +
      '/projects — проекты\n' +
      '/today — задачи на сегодня\n' +
      '/help — помощь',
    { parse_mode: 'Markdown' },
  )
}
