/**
 * Регистрация меню команд бота в Telegram.
 * Запуск: pnpm bot:commands
 */
import 'dotenv/config'
import { bot } from '../src/bot'
import { BOT_COMMANDS } from '../src/bot/commands'

async function main() {
  await bot.api.setMyCommands(BOT_COMMANDS)
  const registered = await bot.api.getMyCommands()
  console.log('✅ Команды зарегистрированы:')
  for (const c of registered) console.log(`  /${c.command} — ${c.description}`)

  // Кнопка слева от поля ввода — список команд.
  //
  // Дефолтная кнопка глобальна для всех чатов, и её легко испортить: локальный
  // запуск с ngrok-адресом в WEBAPP_URL однажды прописал сюда web_app, который
  // в проде ведёт в никуда. Ставим commands — Mini App открывается постоянной
  // кнопкой над полем ввода и командой /app.
  await bot.api.setChatMenuButton({ menu_button: { type: 'commands' } })
  const menu = await bot.api.getChatMenuButton()
  console.log(`✅ Кнопка меню: ${menu.type}`)
}

main().catch((err) => {
  console.error('❌ Ошибка:', err)
  process.exit(1)
})
