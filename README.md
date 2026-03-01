# TG Planer

Telegram-бот планировщик задач с AI-парсингом естественного языка.

Отправляешь боту текст или голосовое вроде «Купить молоко завтра к 18:00» — он сам разбирает название, дедлайн и приоритет, предлагает подтвердить через inline-кнопки. Поддерживает несколько задач в одном сообщении, повторяющиеся напоминания, утренние/вечерние дайджесты и автоформирование плана дня.

## Стек

- **Next.js 16** (App Router) + TypeScript strict
- **Drizzle ORM** + PostgreSQL
- **grammy** — Telegram Bot API
- **OpenRouter** (OpenAI-compatible) — AI-парсинг задач
- **OpenAI Whisper** — распознавание голосовых сообщений
- **rrule** — повторяющиеся напоминания (RFC 5545)
- **Vercel** — деплой + Cron Jobs

## Быстрый старт (локально)

### 1. Установка зависимостей

```bash
pnpm install
```

### 2. Переменные окружения

Скопировать `.env.example` в `.env` и заполнить:

```env
# База данных
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/tg_planer"

# Telegram Bot (получить у @BotFather)
BOT_TOKEN="..."

# LLM (OpenRouter)
LLM_API_KEY="sk-or-v1-..."
LLM_MODEL="openai/gpt-4o-mini"
LLM_BASE_URL="https://openrouter.ai/api/v1"

# Webhook (для dev через ngrok)
WEBHOOK_URL="https://your-url.ngrok-free.dev/api/telegram/webhook"

# Vercel Cron Secret (для prod)
CRON_SECRET=""
```

### 3. Запуск PostgreSQL

```bash
pnpm db:up          # Docker Compose (порт 5433)
```

### 4. Миграция БД

```bash
pnpm db:generate    # Генерация миграций из схемы
pnpm db:migrate     # Применение миграций
```

### 5. Запуск бота

**Polling-режим** (проще, не нужен ngrok):

```bash
pnpm bot:dev
```

**Webhook-режим** (через ngrok):

```bash
# Терминал 1: Next.js
pnpm dev

# Терминал 2: ngrok
ngrok http 3004

# Терминал 3: установить webhook (после обновления WEBHOOK_URL в .env)
pnpm bot:webhook
```

### 6. Просмотр БД

```bash
pnpm db:studio      # Drizzle Studio (веб-интерфейс)
```

## Команды бота

| Команда | Описание |
|---------|----------|
| `/start` | Регистрация, создание проекта «Входящие» |
| `/help` | Справка по командам |
| `/projects` | Список проектов |
| `/tasks` | Все активные задачи (с автоприоритетом) |
| `/today` | «Мой день» — автоматический план на сегодня |

Текстовое или голосовое сообщение — AI-парсинг и создание задач (можно несколько в одном сообщении).

## Структура проекта

```
src/
├── app/api/
│   ├── telegram/webhook/route.ts   # Webhook endpoint
│   ├── cron/reminders/route.ts     # Cron: отправка напоминаний
│   └── cron/digest/route.ts       # Cron: утренний/вечерний дайджест
├── bot/
│   ├── index.ts                    # Инициализация бота (grammy)
│   ├── dev.ts                      # Polling-режим для разработки
│   ├── set-webhook.ts              # Скрипт установки webhook
│   ├── handlers/                   # Обработчики команд
│   │   ├── start.ts, help.ts
│   │   ├── message.ts              # AI-парсинг текста (мульти-задачи)
│   │   ├── voice.ts               # Голосовые сообщения (Whisper)
│   │   ├── callback.ts             # Inline-кнопки
│   │   └── projects.ts, tasks.ts
│   ├── keyboards/task.ts           # Inline-клавиатуры
│   ├── middleware/user.ts          # Извлечение/создание пользователя
│   ├── services/
│   │   ├── pending-store.ts        # Временное хранение (Map + TTL)
│   │   ├── my-day.ts              # Логика «Моего дня»
│   │   ├── digest.ts              # Утренний/вечерний дайджест
│   │   ├── scoring.ts             # Алгоритм автоприоритета
│   │   └── format.ts              # Форматирование сообщений
│   └── types.ts
├── lib/
│   ├── ai/
│   │   ├── types.ts                # LLMProvider интерфейс
│   │   ├── provider.ts             # Абстракция: get/set провайдер
│   │   ├── openai-provider.ts      # OpenAI-compatible (OpenRouter)
│   │   ├── init.ts                 # Инициализация из env
│   │   └── prompts/parse-task.ts   # Системный промпт парсинга
│   ├── speech/
│   │   └── whisper.ts              # Whisper API клиент
│   ├── reminders/
│   │   └── rrule-parser.ts         # Парсинг повторений (rrule)
│   └── db/
│       ├── schema.ts               # Drizzle схема (users, projects, tasks, reminders)
│       └── index.ts                # Drizzle client
drizzle/                            # Миграции
drizzle.config.ts                   # Конфигурация Drizzle Kit
docker-compose.yml                  # PostgreSQL для локальной разработки
vercel.json                         # Cron Jobs конфигурация
```

## Скрипты

| Скрипт | Описание |
|--------|----------|
| `pnpm dev` | Next.js dev-сервер (порт 3004) |
| `pnpm bot:dev` | Бот в polling-режиме |
| `pnpm bot:webhook` | Установка Telegram webhook |
| `pnpm db:up` | Запуск PostgreSQL (Docker) |
| `pnpm db:down` | Остановка PostgreSQL |
| `pnpm db:generate` | Генерация миграций |
| `pnpm db:migrate` | Применение миграций |
| `pnpm db:studio` | Drizzle Studio |

## Деплой на Vercel

1. Подключить репозиторий к Vercel
2. Добавить environment variables: `BOT_TOKEN`, `DATABASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`, `CRON_SECRET`
3. Настроить Vercel Postgres или внешнюю БД
4. После деплоя установить webhook: `pnpm bot:webhook` (с production URL в `WEBHOOK_URL`)
