/**
 * Регистрация меню команд бота в Telegram.
 *
 *   pnpm bot:commands                      — бот из .env (тестовый)
 *   BOT_TOKEN=<прод-токен> pnpm bot:commands — боевой бот
 *
 * Токен в .env принадлежит ТЕСТОВОМУ боту (@vpv_planner_bot), а прод работает
 * под @vpvPlannerBot с токеном из Vercel env. Скрипт печатает, к какому боту
 * применяется: однажды все настройки молча уехали в тестового, и полдня было
 * неясно, почему в боевом ничего не меняется.
 *
 * Прод-токен: `npx vercel env pull` → строка BOT_TOKEN.
 */
import 'dotenv/config'
import { bot } from '../src/bot'
import { BOT_COMMANDS } from '../src/bot/commands'

/**
 * Клиент выбирает список по самому узкому подходящему scope и кэширует его.
 * Одного `default` оказалось мало: пока приватные чаты стояли пустыми,
 * подсказка при вводе «/» не появлялась. Пишем во все три уровня.
 */
const SCOPES = [
  undefined,
  { type: 'all_private_chats' as const },
]

async function main() {
  const me = await bot.api.getMe()
  console.log(`🤖 Бот: @${me.username} (${me.first_name})`)

  for (const scope of SCOPES) {
    await bot.api.setMyCommands(BOT_COMMANDS, scope ? { scope } : undefined)
  }

  const registered = await bot.api.getMyCommands()
  console.log('✅ Команды зарегистрированы (default + all_private_chats):')
  for (const c of registered) console.log(`  /${c.command} — ${c.description}`)

  // Кнопка меню открывает Mini App во весь экран; подсказка команд от неё
  // не зависит. Локальный адрес сюда ставить нельзя: он глобальный для всех
  // чатов, и однажды ngrok из .env уже уехал в прод-кнопку.
  const url = process.env.WEBAPP_URL
  if (!url) {
    console.log('⚠️  WEBAPP_URL не задан — кнопку меню не трогаю')
    return
  }
  if (/ngrok|localhost|127\.0\.0\.1/.test(url)) {
    console.log(`⚠️  WEBAPP_URL локальный (${url}) — кнопку меню не трогаю,`)
    console.log('    иначе она уедет на временный туннель у всех пользователей.')
    return
  }

  await bot.api.setChatMenuButton({
    menu_button: { type: 'web_app', text: '📱 Планировщик', web_app: { url } },
  })
  console.log(`✅ Кнопка меню → ${url}`)
}

main().catch((err) => {
  console.error('❌ Ошибка:', err)
  process.exit(1)
})
