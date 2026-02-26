/**
 * Установка Telegram webhook.
 * Запуск: pnpm bot:webhook
 */
import 'dotenv/config'
import { bot } from './index'

async function main() {
  const webhookUrl = process.env.WEBHOOK_URL
  if (!webhookUrl) {
    console.error('❌ WEBHOOK_URL не задан в .env')
    process.exit(1)
  }

  await bot.api.setWebhook(webhookUrl)
  console.log(`✅ Webhook установлен: ${webhookUrl}`)

  const info = await bot.api.getWebhookInfo()
  console.log('📋 Webhook info:', JSON.stringify(info, null, 2))
}

main().catch((err) => {
  console.error('❌ Ошибка:', err)
  process.exit(1)
})
