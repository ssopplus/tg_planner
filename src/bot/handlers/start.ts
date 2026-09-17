import { Context, Keyboard } from 'grammy'
import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { BotContext } from '../middleware/user'
import { miniAppKeyboard } from '../keyboards/task'

/**
 * /start — приветствие, создание дефолтного проекта "Входящие"
 */
/**
 * Постоянная кнопка над полем ввода, открывающая Mini App.
 *
 * Нужна потому, что кнопка меню слева отдана списку команд: Telegram
 * позволяет там только одно, а команды без неё не найти. Reply-клавиатура
 * висит всегда (`persistent`), так что быстрый вход в приложение сохраняется.
 */
function miniAppReplyKeyboard(webappUrl: string | undefined): Keyboard | undefined {
  if (!webappUrl) return undefined
  return new Keyboard().webApp('📱 Планировщик', webappUrl).resized().persistent()
}

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

  // Кнопка слева от поля ввода — список команд, а не Mini App.
  //
  // Она там одна: кнопка типа web_app вытесняет стандартное меню, и тогда
  // команды вообще негде посмотреть. Mini App от этого не теряется — она
  // уезжает на постоянную кнопку над полем ввода (см. ниже) и остаётся
  // доступна командой /app.
  const webappUrl = process.env.WEBAPP_URL
  if (ctx.chat) {
    try {
      await ctx.api.setChatMenuButton({
        chat_id: ctx.chat.id,
        menu_button: { type: 'commands' },
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
      '/coord — списать координацию\n' +
      '/app — открыть Mini App\n' +
      '/help — помощь',
    { parse_mode: 'Markdown', reply_markup: miniAppReplyKeyboard(webappUrl) },
  )
}
