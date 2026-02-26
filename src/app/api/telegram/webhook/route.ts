import { webhookCallback } from 'grammy'
import { bot } from '@/bot'

// grammy webhook adapter для Next.js App Router
export const POST = webhookCallback(bot, 'std/http')
