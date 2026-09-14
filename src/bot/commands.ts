/**
 * Список команд бота для меню Telegram.
 *
 * Telegram показывает подсказку по «/» только из того, что зарегистрировано
 * через setMyCommands — сама по себе `bot.command(...)` в меню не попадает.
 * Пока список не был зарегистрирован, команды работали, но найти их можно было
 * только по памяти.
 *
 * Регистрируется при установке вебхука (`pnpm bot:webhook`) и отдельной
 * командой `pnpm bot:commands`.
 */
import type { BotCommand } from 'grammy/types'

export const BOT_COMMANDS: BotCommand[] = [
  { command: 'today', description: '☀️ Мой день' },
  { command: 'tasks', description: '📋 Все активные задачи' },
  { command: 'coord', description: '⏱ Координация: списать время' },
  { command: 'projects', description: '📁 Проекты' },
  { command: 'app', description: '📱 Открыть планировщик' },
  { command: 'help', description: '❓ Справка' },
]
