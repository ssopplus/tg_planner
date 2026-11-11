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

  // Секрет Telegram присылает в X-Telegram-Bot-Api-Secret-Token, вебхук сверяет его с тем же env.
  const secret = process.env.WEBHOOK_SECRET || undefined
  if (secret && !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    console.error('❌ WEBHOOK_SECRET: только A-Z, a-z, 0-9, _ и -, до 256 символов')
    process.exit(1)
  }
  await bot.api.setWebhook(webhookUrl, { secret_token: secret })
  console.log(`✅ Webhook установлен: ${webhookUrl}${secret ? ' (с секретом)' : ' — ⚠️ без WEBHOOK_SECRET'}`)

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
