import { Context } from 'grammy'
import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { BotContext } from '../middleware/user'
import { miniAppKeyboard } from '../keyboards/task'

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

  // Устанавливаем Menu Button для открытия Mini App
  const webappUrl = process.env.WEBAPP_URL
  if (webappUrl && ctx.chat) {
    try {
      await ctx.api.setChatMenuButton({
        chat_id: ctx.chat.id,
        menu_button: {
          type: 'web_app',
          text: '📱 Планировщик',
          web_app: { url: webappUrl },
        },
      })
    } catch (e) {
      console.error('Не удалось установить Menu Button:', e)
    }
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
      '/app — открыть Mini App\n' +
      '/help — помощь',
    { parse_mode: 'Markdown' },
  )
}
