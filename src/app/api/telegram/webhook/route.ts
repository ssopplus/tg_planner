import { webhookCallback } from 'grammy'
import { bot } from '@/bot'

/**
 * grammy webhook adapter для Next.js App Router.
 *
 * WEBHOOK_SECRET сверяется с заголовком X-Telegram-Bot-Api-Secret-Token: без него
 * любой, кто знает URL, мог прислать боту поддельное обновление от моего Telegram id.
 * Telegram ставит заголовок, только если секрет передан в setWebhook (`pnpm bot:webhook`).
 * Порядок включения: env на Vercel → `pnpm bot:webhook` → деплой с этой проверкой.
 * Переменная не задана — проверки нет, как раньше.
 */
export const POST = webhookCallback(bot, 'std/http', {
  secretToken: process.env.WEBHOOK_SECRET || undefined,
})
