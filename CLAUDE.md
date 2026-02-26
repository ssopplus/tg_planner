# CLAUDE.md

## Язык

- Все ответы, комментарии в коде, документация и коммиты — на **русском языке**
- Имена файлов и переменных — на английском (kebab-case для файлов, camelCase для переменных)

## Стек

- **Фреймворк:** Next.js (App Router) + TypeScript strict
- **ORM:** Drizzle ORM (НЕ Prisma) + PostgreSQL
- **Бот:** grammy (webhook, не polling)
- **LLM:** OpenRouter (OpenAI-compatible API). Env: `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`
- **Пакетный менеджер:** pnpm
- **Деплой:** Vercel

## Структура проекта

```
src/
  app/api/            # API routes (webhook, cron)
  bot/handlers/       # Обработчики команд бота
  bot/keyboards/      # Inline-клавиатуры
  bot/services/       # Бизнес-логика бота
  lib/ai/             # LLM абстракция и провайдеры
  lib/db/schema.ts    # Drizzle схема БД
  lib/db/index.ts     # Drizzle client
  lib/telegram/       # Telegram API обёртки
  types/              # Общие типы
drizzle.config.ts     # Конфигурация Drizzle Kit
```
