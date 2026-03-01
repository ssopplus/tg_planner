import { Bot } from 'grammy'
import { handleStart } from './handlers/start'
import { handleHelp } from './handlers/help'
import { handleApp } from './handlers/app'
import { handleMessage } from './handlers/message'
import { handleVoice } from './handlers/voice'
import { handleCallback } from './handlers/callback'
import { handleProjects } from './handlers/projects'
import { handleTasks } from './handlers/tasks'
import { userMiddleware } from './middleware/user'
import { initAI } from '@/lib/ai/init'

const token = process.env.BOT_TOKEN
if (!token) {
  throw new Error('BOT_TOKEN не задан в переменных окружения')
}

// Инициализация AI-провайдера
initAI()

export const bot = new Bot(token)

// Middleware: извлечение/создание пользователя в БД
bot.use(userMiddleware)

// Команды
bot.command('start', handleStart)
bot.command('help', handleHelp)
bot.command('app', handleApp)
bot.command('projects', handleProjects)
bot.command('tasks', handleTasks)
bot.command('today', handleTasks) // /today — «Мой день»

// Callback queries (inline-кнопки)
bot.on('callback_query:data', handleCallback)

// Голосовые сообщения — Whisper + AI-парсинг
bot.on('message:voice', handleVoice)

// Текстовые сообщения — AI-парсинг
bot.on('message:text', handleMessage)
