# CLAUDE.md

## Правила работы

- **Не запускай dev сервер самостоятельно** — если нужно запустить `pnpm dev` или другой сервер, попроси пользователя сделать это

## Язык

- Все ответы, комментарии в коде, документация и коммиты — на **русском языке**
- Имена файлов и переменных — на английском (kebab-case для файлов, camelCase для переменных)

## Стек

- **Фреймворк:** Next.js (App Router) + TypeScript strict
- **ORM:** Drizzle ORM (НЕ Prisma) + PostgreSQL
- **Бот:** grammy (webhook для prod, polling для dev)
- **LLM:** OpenRouter (OpenAI-compatible API). Env: `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`
- **Голос (STT):** цепочка провайдеров с автоматическим fallback — Groq Whisper-large-v3-turbo (основной) → AssemblyAI Universal-2 (резерв) → OpenAI Whisper (legacy). Env: `STT_PROVIDERS`, `GROQ_API_KEY`, `ASSEMBLYAI_API_KEY`. Реализация: [src/lib/speech/](src/lib/speech/)
- **Повторения:** rrule (RFC 5545)
- **Mini App UI:** Tailwind CSS v4 + lucide-react + cva + @dnd-kit
- **Пакетный менеджер:** pnpm
- **Деплой:** Vercel + Cron Jobs

## Структура проекта

```
src/
  app/(mini-app)/             # Telegram Mini App (клиентские страницы)
    today/                    # «Мой день» с drag-n-drop
    tasks/                    # Список задач + детали задачи [id]
    projects/                 # Проекты + задачи проекта [id]
    settings/                 # Настройки (timezone, дайджест)
    archive/                  # Архив выполненных задач
  app/api/telegram/webhook/   # Telegram webhook endpoint
  app/api/tasks/              # REST API: задачи (CRUD + подзадачи)
  app/api/projects/           # REST API: проекты (CRUD)
  app/api/today/              # REST API: «Мой день» (GET/PATCH reorder)
  app/api/settings/           # REST API: настройки пользователя
  app/api/cron/reminders/     # Cron Job: отправка напоминаний (каждую минуту)
  app/api/cron/digest/        # Cron Job: утренний/вечерний дайджест (каждые 15 мин)
  app/api/cron/archive/       # Cron Job: автоархивация DONE>7д (раз в день 03:00)
  components/ui/              # UI компоненты (Button, Card, Badge, Checkbox, Progress, PullToRefresh)
  components/layout/          # Layout (NavBar, Header)
  components/tasks/           # TaskCard, TaskList, SortableTaskList, SwipeableTaskCard
  components/projects/        # ProjectCard
  bot/                        # Telegram бот (grammy)
    handlers/                 # Обработчики: start, help, message, voice, callback, projects, tasks
    keyboards/                # Inline-клавиатуры (confirm, reminder, overdue, myDay)
    middleware/                # Middleware (user extraction)
    services/                 # Бизнес-логика (pending-store, my-day, digest, scoring, format)
  lib/ai/                     # LLM абстракция и провайдеры
    prompts/                  # Системные промпты (парсинг мульти-задач + повторения)
  lib/speech/                 # Whisper API клиент
  lib/reminders/              # Логика повторений (rrule-parser)
  lib/telegram/               # WebApp SDK утилиты + auth (HMAC валидация)
  lib/db/                     # Drizzle ORM (schema + client)
drizzle/                      # SQL миграции
docs/plans/                   # Планы разработки (ADR workflow)
```

## Архитектурные решения

- **Монолит на Next.js** — бот и Mini App в одном проекте
- **Drizzle ORM** — SQL-like API, быстрый на serverless, отличная TypeScript типизация
- **grammy** — TypeScript-first Telegram Bot API, нативные webhooks
- **LLM-абстракция** — интерфейс `LLMProvider`, сменяемые провайдеры (`src/lib/ai/provider.ts`)
- **Pending store** — in-memory Map с TTL 5 мин для распарсенных задач до подтверждения
- **Cron — внешний триггер** ([cron-job.org](https://cron-job.org)), потому что free Vercel ограничен 1 запуском/сутки. Эндпоинты живут в `/api/cron/*`, проверяют `Authorization: Bearer ${CRON_SECRET}`. Расписание и URL — см. [docs/cron-setup.md](docs/cron-setup.md). `vercel.json` не содержит секции `crons`.
- **Миграции БД — только через GitHub Actions** (`.github/workflows/db-migrate.yml`). На прод вручную не накатывать. См. [docs/migrations.md](docs/migrations.md).
- **Автоприоритет** — скоринг задач: дедлайн сегодня (+100/+80), просрочено (+90), завтра (+70/+55), HIGH (+50), давность (+5/день до +30), переносы (+10 за каждый)
- **«Мой день»** — автоформирование: жёсткие дедлайны → просроченные → мягкие дедлайны → HIGH без даты, лимит 7 задач
- **Мульти-парсинг** — AI возвращает массив `ParsedTask[]`, одно сообщение = несколько задач
- **Повторения** — rrule RFC 5545, автосоздание следующего напоминания при срабатывании

## БД (Drizzle схема)

5 таблиц: `users`, `projects`, `tasks`, `reminders`, `subtasks`
- Enums: `project_type`, `task_status`, `priority`, `deadline_type`, `reminder_type`, `reminder_status`
- Relations: user → projects → tasks → reminders
- Каскадное удаление через foreign keys
- Индексы на часто запрашиваемые поля

## Локальная разработка

- PostgreSQL через Docker Compose (порт **5433**, не 5432 — занят)
- Next.js на порту **3004** (3000 занят)
- Polling-режим: `pnpm bot:dev` (без ngrok)
- Webhook-режим: ngrok + `pnpm bot:webhook`

## Добавление нового проекта (vault → БД)

Источник истины для проектов — Obsidian-vault в [Документация/Проекты/](../../../Документация/Проекты/). Структура: `Проекты/<категория>/<slug>/index.md` (Vodohod или Личное).

**Автообнаружение (рекомендуется):**
1. Склонировать репу в `Vodohod/Projects/<slug>/` или `Личное/project/<slug>/`.
2. Запустить `pnpm sync:vault` — фаза discovery найдёт папку с `.git`, создаст шаблонный `index.md` + `tasks.md` в vault (категория определится по корню), потом обычный импорт добавит проект в БД.
3. Дополнить `index.md` описанием проекта — потом или прогонишь `sync:vault` ещё раз, или дождёшься автосинка (когда сделаем).

**Вручную (если нужен нестандартный шаблон):**
1. Создать `Документация/Проекты/<категория>/<slug>/{index.md, tasks.md}`. Для мультирепо — в frontmatter `repos: [{slug,name}]` (см. pola-erp).
2. `pnpm sync:vault` — UPSERT по `(user_id, slug)`.

Скрипт ищет репо в `Vodohod/Projects/` и `Личное/project/`. Инфра-каталоги (`ansible`) — в `IGNORED_REPO_SLUGS`. Мультирепо-slug'и из `frontmatter.repos` считаются занятыми — pola-erp не превратится обратно в три отдельных проекта.

**Флаги:**
- `--user-id=<uuid>` — только для конкретного пользователя.
- `--no-discover` — пропустить создание новых заметок в vault.

Локально работает с локальной БД или с прод-Supabase (какая указана в `DATABASE_URL`).

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
| `STT_PROVIDERS` | Порядок STT-провайдеров через запятую (default: `groq,assemblyai,whisper`) |
| `GROQ_API_KEY` | Groq API key — основной STT (whisper-large-v3-turbo) |
| `ASSEMBLYAI_API_KEY` | AssemblyAI API key — резервный STT (Universal-2) |
| `WHISPER_API_KEY` | Legacy: OpenAI Whisper API key (deprecated) |
| `WHISPER_BASE_URL` | Legacy: Base URL Whisper API (default: `https://api.openai.com/v1`) |
| `WEBAPP_URL` | URL Mini App для кнопки в боте |
| `GITHUB_WEBHOOK_SECRET` | Секрет GitHub-вебхука vault'а (см. `docs/obsidian-sync.md`) |
| `GITHUB_VAULT_TOKEN` | PAT с правом `repo` на vault-репозиторий (read+write-back) |
| `OBSIDIAN_SYNC_USER_ID` | UUID пользователя для привязки задач из vault (опционально, если в БД один user) |
| `YANDEX_TRACKER_TOKEN` | OAuth-токен Яндекс Трекера для pull-синхронизации (см. `docs/yandex-tracker-sync.md`) |
| `YANDEX_TRACKER_ORG_ID` | Числовой ID организации Яндекс 360 (напр. `7026646` — vodohod.ru), передаётся в заголовке `X-Org-ID` |
| `TRACKER_SYNC_USER_ID` | UUID пользователя для привязки YT-тикетов (опционально, если в БД один user) |
