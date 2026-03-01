import { Context } from 'grammy'
import { miniAppKeyboard } from '../keyboards/task'

/**
 * /app — открыть Mini App (планировщик)
 */
export async function handleApp(ctx: Context) {
  await ctx.reply('📱 Нажми кнопку, чтобы открыть планировщик:', {
    reply_markup: miniAppKeyboard(),
  })
}
