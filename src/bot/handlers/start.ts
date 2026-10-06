import { Context } from 'grammy'
import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { BotContext } from '../middleware/user'
import { mainKeyboard } from '../keyboards/main'

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

  // Кнопка слева от поля ввода открывает Mini App во весь экран.
  //
  // Вариант type: 'commands' здесь не нужен: подсказка команд при вводе «/»
  // работает от setMyCommands и от этой кнопки не зависит (см. bot/commands.ts).
  // А web_app с reply-клавиатуры Telegram открывает компактно, во весь экран —
  // только отсюда.
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
      'Планировщик состоит из двух половин: рабочей — задачи Яндекс.Трекера ' +
      'со списанием времени, и личной — доски дел по срокам.\n\n' +
      '**Дело пишется обычным сообщением:**\n' +
      '• «поменять резину на машине на следующей неделе»\n' +
      '• «записаться к врачу в четверг»\n\n' +
      'Кнопки под полем ввода — для частого: новое дело, списание времени, ' +
      'сводка дня и координация.',
    { parse_mode: 'Markdown', reply_markup: mainKeyboard() },
  )
}
