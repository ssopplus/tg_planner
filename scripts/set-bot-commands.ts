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
}

main().catch((err) => {
  console.error('❌ Ошибка:', err)
  process.exit(1)
})
