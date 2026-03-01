import { Context } from 'grammy'
import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { transcribeAudio } from '@/lib/speech/whisper'
import { parseTasksText } from '@/lib/ai/provider'
import { addPendingTask } from '../services/pending-store'
import { confirmKeyboard, confirmMultiKeyboard } from '../keyboards/task'
import { BotContext } from '../middleware/user'
import { formatTaskPreview } from '../services/format'

/**
 * Обработчик голосовых сообщений.
 * Транскрибирует через Whisper → парсит через AI → показ с кнопками.
 */
export async function handleVoice(ctx: Context) {
  const voice = ctx.message?.voice
  if (!voice) return

  const { dbUser } = ctx as BotContext

  const apiKey = process.env.WHISPER_API_KEY ?? process.env.LLM_API_KEY
  if (!apiKey) {
    await ctx.reply('Голосовые сообщения не поддерживаются — не настроен API ключ.')
    return
  }

  // Показываем typing indicator пока распознаём
  await ctx.replyWithChatAction('typing')

  try {
    // Скачиваем файл от Telegram
    const file = await ctx.api.getFile(voice.file_id)
    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`
    const response = await fetch(fileUrl)
    const audioBuffer = Buffer.from(await response.arrayBuffer())

    // Транскрипция
    const transcription = await transcribeAudio(audioBuffer, apiKey)

    if (!transcription || transcription.trim() === '') {
      await ctx.reply('Не удалось распознать речь. Попробуй ещё раз.')
      return
    }

    await ctx.reply(`🎤 Распознано: "${transcription}"`)

    // Получаем проекты для контекста
    const userProjects = await db
      .select({ id: projects.id, name: projects.name, isDefault: projects.isDefault })
      .from(projects)
      .where(eq(projects.userId, dbUser.id))

    const projectNames = userProjects.map((p) => p.name)
    const defaultProject = userProjects.find((p) => p.isDefault) ?? userProjects[0]

    if (!defaultProject) {
      await ctx.reply('Сначала выполни /start для настройки.')
      return
    }

    // AI-парсинг (может вернуть несколько задач)
    const now = new Date()
    const parsedTasks = await parseTasksText(transcription, {
      currentDate: now.toISOString(),
      timezone: dbUser.timezone,
      projects: projectNames,
    })

    if (parsedTasks.length === 0) {
      await ctx.reply('Не удалось распознать задачи из голосового сообщения.')
      return
    }

    // Сохраняем в pending store и показываем
    const pendingIds: string[] = []

    for (const parsed of parsedTasks) {
      let targetProjectId = defaultProject.id
      if (parsed.project) {
        const matched = userProjects.find(
          (p) => p.name.toLowerCase() === parsed.project!.toLowerCase(),
        )
        if (matched) targetProjectId = matched.id
      }

      const targetProject = userProjects.find((p) => p.id === targetProjectId)

      const pendingId = addPendingTask({
        title: parsed.title,
        description: parsed.description,
        projectId: targetProjectId,
        priority: parsed.priority ?? undefined,
        deadlineAt: parsed.deadlineAt ? new Date(parsed.deadlineAt) : undefined,
        deadlineType: parsed.deadlineType ?? undefined,
      })

      pendingIds.push(pendingId)

      if (parsedTasks.length === 1) {
        // Одна задача — как обычно
        const preview = formatTaskPreview(parsed, targetProject?.name)
        await ctx.reply(preview, {
          parse_mode: 'Markdown',
          reply_markup: confirmKeyboard(pendingId),
        })
      }
    }

    if (parsedTasks.length > 1) {
      // Несколько задач — показываем все с общей клавиатурой
      const lines: string[] = [`🎤 Распознано задач: **${parsedTasks.length}**\n`]

      for (let i = 0; i < parsedTasks.length; i++) {
        const parsed = parsedTasks[i]
        const targetProjectId = pendingIds[i]
        lines.push(`${i + 1}. **${parsed.title}**`)
        if (parsed.deadlineAt) {
          const date = new Date(parsed.deadlineAt)
          lines.push(
            `   📅 ${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`,
          )
        }
      }

      await ctx.reply(lines.join('\n'), {
        parse_mode: 'Markdown',
        reply_markup: confirmMultiKeyboard(pendingIds),
      })
    }
  } catch (error) {
    console.error('Ошибка обработки голосового сообщения:', error)
    await ctx.reply('Произошла ошибка при обработке голосового сообщения. Попробуй текстом.')
  }
}
