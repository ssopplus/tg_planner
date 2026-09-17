/**
 * Регистрация меню команд бота в Telegram.
 * Запуск: pnpm bot:commands
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
