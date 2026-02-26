# CLAUDE.md

## Язык

- Все ответы, комментарии в коде, документация и коммиты — на **русском языке**
- Имена файлов и переменных — на английском (kebab-case для файлов, camelCase для переменных)

## Стек

- **Фреймворк:** Next.js (App Router) + TypeScript strict
- **ORM:** Drizzle ORM (НЕ Prisma) + PostgreSQL
- **Бот:** grammy (webhook для prod, polling для dev)
- **LLM:** OpenRouter (OpenAI-compatible API). Env: `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`
- **Пакетный менеджер:** pnpm
- **Деплой:** Vercel + Cron Jobs

## Структура проекта

```
src/
  app/api/telegram/webhook/   # Telegram webhook endpoint
  app/api/cron/reminders/     # Cron Job: отправка напоминаний
  bot/                        # Telegram бот (grammy)
    handlers/                 # Обработчики команд и сообщений
    keyboards/                # Inline-клавиатуры
    middleware/                # Middleware (user extraction)
    services/                 # Бизнес-логика (pending store)
  lib/ai/                     # LLM абстракция и провайдеры
    prompts/                  # Системные промпты
  lib/db/                     # Drizzle ORM (schema + client)
drizzle/                      # SQL миграции
docs/plans/                   # Планы разработки (ADR workflow)
```

## Архитектурные решения

- **Монолит на Next.js** — бот и будущий Mini App в одном проекте
- **Drizzle ORM** — SQL-like API, быстрый на serverless, отличная TypeScript типизация
- **grammy** — TypeScript-first Telegram Bot API, нативные webhooks
- **LLM-абстракция** — интерфейс `LLMProvider`, сменяемые провайдеры (`src/lib/ai/provider.ts`)
- **Pending store** — in-memory Map с TTL 5 мин для распарсенных задач до подтверждения
- **Cron через Vercel** — `/api/cron/reminders` раз в минуту, проверка `CRON_SECRET`

## БД (Drizzle схема)

4 таблицы: `users`, `projects`, `tasks`, `reminders`
- Enums: `project_type`, `task_status`, `priority`, `deadline_type`, `reminder_type`, `reminder_status`
- Relations: user → projects → tasks → reminders
- Каскадное удаление через foreign keys
- Индексы на часто запрашиваемые поля

## Локальная разработка

- PostgreSQL через Docker Compose (порт **5433**, не 5432 — занят)
- Next.js на порту **3004** (3000 занят)
- Polling-режим: `pnpm bot:dev` (без ngrok)
- Webhook-режим: ngrok + `pnpm bot:webhook`

## Env переменные

| Переменная | Описание |
|------------|----------|
| `DATABASE_URL` | PostgreSQL connection string |
| `BOT_TOKEN` | Telegram Bot API token |
| `LLM_API_KEY` | OpenRouter API key |
| `LLM_MODEL` | Модель (default: `openai/gpt-4o-mini`) |
| `LLM_BASE_URL` | Base URL API (default: OpenRouter) |
| `WEBHOOK_URL` | Telegram webhook URL |
| `CRON_SECRET` | Секрет для верификации cron запросов |
