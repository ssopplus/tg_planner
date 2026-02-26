/**
 * Локальный запуск бота в polling-режиме.
 * Используется для разработки вместо webhook.
 *
 * Запуск: pnpm bot:dev
 */
import 'dotenv/config'
import { bot } from './index'

async function main() {
  console.log('🤖 Запускаю бота в polling-режиме...')

  // Удаляем webhook, если был установлен (иначе polling не работает)
  await bot.api.deleteWebhook()

  bot.start({
    onStart: () => console.log('✅ Бот запущен! Отправь /start в Telegram.'),
  })
}

main().catch((err) => {
  console.error('❌ Ошибка запуска бота:', err)
  process.exit(1)
})
