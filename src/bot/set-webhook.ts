/**
 * Установка Telegram webhook.
 * Запуск: pnpm bot:webhook
 */
import 'dotenv/config'
import { bot } from './index'
import { BOT_COMMANDS } from './commands'

async function main() {
  const webhookUrl = process.env.WEBHOOK_URL
  if (!webhookUrl) {
    console.error('❌ WEBHOOK_URL не задан в .env')
    process.exit(1)
  }

  await bot.api.setWebhook(webhookUrl)
  console.log(`✅ Webhook установлен: ${webhookUrl}`)

  // Меню команд живёт на стороне Telegram и само по себе не появляется —
  // обновляем его тем же действием, что и вебхук.
  await bot.api.setMyCommands(BOT_COMMANDS)
  console.log(`✅ Команды зарегистрированы: ${BOT_COMMANDS.map((c) => '/' + c.command).join(', ')}`)

  const info = await bot.api.getWebhookInfo()
  console.log('📋 Webhook info:', JSON.stringify(info, null, 2))
}

main().catch((err) => {
  console.error('❌ Ошибка:', err)
  process.exit(1)
})
