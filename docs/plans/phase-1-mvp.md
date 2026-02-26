# Phase 1 — MVP (Минимальный продукт)

> Источник требований: [docs/DOMAIN.md](../DOMAIN.md)

## Цель

Рабочий Telegram-бот с AI-парсингом естественного языка, базовым CRUD задач/проектов, простыми напоминаниями и деплоем на Vercel. Пользователь может создавать задачи текстом, получать подтверждение парсинга и управлять задачами через inline-кнопки.

## Scope

- Single-user (но архитектура готова к multi-user)
- Только текстовый ввод (голос — Phase 2)
- Только чат-интерфейс (Mini App — Phase 3)
- Русский язык

---

## Задачи

### 1. Инициализация проекта

**Описание:** Создание монорепо на Next.js с TypeScript, настройка линтеров и структуры папок.

**Технические решения:**
- Next.js 14+ (App Router) — единый фреймворк для API routes (webhook бота) и будущего Mini App
- TypeScript strict mode
- ESLint + Prettier
- pnpm как пакетный менеджер

**Структура проекта:**
```
src/
  app/
    api/
      telegram/
        webhook/route.ts    # Telegram webhook endpoint
  bot/
    handlers/               # Обработчики команд и сообщений
      start.ts
      message.ts
      callback.ts
    keyboards/              # Inline-клавиатуры
    services/               # Бизнес-логика бота
  lib/
    ai/                     # LLM абстракция
    db/                     # Drizzle ORM и утилиты
    telegram/               # Telegram Bot API обёртка
  types/                    # Общие типы
drizzle.config.ts
src/lib/db/schema.ts
```

### 2. Настройка PostgreSQL + ORM

**Описание:** Подключение PostgreSQL через Drizzle ORM, создание схемы данных.

**Технические решения:**
- Drizzle ORM — типобезопасность, миграции, удобный query builder
- PostgreSQL на Vercel Postgres (или Supabase/Neon как альтернатива)
- Миграции через `drizzle-kit`

**Схема БД:**

Таблицы:
- **users** — telegram_id (unique), username, first_name, timezone, digest_time, settings (JSON), created_at, updated_at
- **projects** — id, user_id (FK), name, type (enum: DEFAULT, SHOPPING), is_default, sort_order, created_at, updated_at
- **tasks** — id, project_id (FK), user_id (FK), title, description, status (enum: TODO, IN_PROGRESS, DONE, ARCHIVED), priority (enum: LOW, MEDIUM, HIGH), deadline_at, deadline_type (enum: HARD, SOFT), completed_at, created_at, updated_at
- **reminders** — id, task_id (FK), user_id (FK), remind_at, type (enum: TIME, BEFORE_DEADLINE), status (enum: PENDING, SENT, CANCELLED), created_at

**Индексы:**
- tasks: (user_id, status), (project_id, status), (deadline_at)
- reminders: (remind_at, status), (user_id)

### 3. Telegram Bot API интеграция

**Описание:** Настройка бота через webhook на Vercel, обработка входящих сообщений.

**Технические решения:**
- Webhook на `/api/telegram/webhook` (не polling — Vercel serverless)
- Библиотека: `grammy` (современная, TypeScript-first, поддержка webhooks)
- Middleware: логирование, обработка ошибок, извлечение/создание пользователя
- Команды: `/start`, `/help`, `/projects`, `/tasks`, `/today`

**Зависимости:** Задача 1 (проект), Задача 2 (БД для хранения пользователей)

### 4. AI-парсинг текста

**Описание:** LLM разбирает сообщение пользователя и извлекает: название задачи, дату/время, проект, приоритет.

**Технические решения:**
- Абстракция LLM-провайдера: интерфейс `LLMProvider` с методом `parse()`
- Первая реализация: OpenAI GPT-4o-mini (дёшево, быстро)
- Structured output (JSON mode / function calling) для надёжного парсинга
- Промпт включает: текущую дату/время, timezone пользователя, список проектов
- Fallback: если LLM недоступен — задача создаётся как есть (без парсинга даты)

**Структура:**
```
src/lib/ai/
  types.ts              # ParsedTask интерфейс
  provider.ts           # LLMProvider абстракция
  openai-provider.ts    # OpenAI реализация
  prompts/
    parse-task.ts       # Промпт для парсинга
```

**Зависимости:** Задача 1 (проект)

### 5. Подтверждение создания через inline-кнопки

**Описание:** После AI-парсинга бот показывает результат и спрашивает подтверждение.

**Поведение:**
1. Пользователь отправляет текст
2. Бот парсит через LLM
3. Бот отвечает: "Задача: X | Срок: Y | Проект: Z" + кнопки [Верно] [Изменить]
4. [Верно] — задача создаётся в БД
5. [Изменить] — бот предлагает что изменить (название / дату / проект / приоритет)

**Технические решения:**
- Callback data в inline-кнопках: `confirm:{temp_id}`, `edit:{temp_id}:{field}`
- Временное хранение распарсенных задач: in-memory Map с TTL 5 минут
- Сериализация callback data — compact формат (Telegram ограничение 64 байта)

**Зависимости:** Задача 3 (бот), Задача 4 (AI-парсинг)

### 6. CRUD проектов и задач

**Описание:** Команды для управления проектами и задачами через бот.

**Функциональность:**
- Проекты: создание, список, переключение активного, удаление (с подтверждением)
- Задачи: список (по проекту / все), завершение, удаление, изменение
- При первом `/start` — создание дефолтного проекта "Входящие"

**Команды и inline-кнопки:**
- `/projects` — список проектов с кнопками управления
- `/tasks` — задачи текущего проекта
- `/today` — задачи на сегодня (по дедлайну)
- Кнопки на каждой задаче: [Готово] [Удалить] [Изменить]

**Зависимости:** Задача 2 (БД), Задача 3 (бот)

### 7. Простые напоминания

**Описание:** Напоминания по конкретному времени.

**Технические решения:**
- Vercel Cron Jobs — проверка каждую минуту (`*/1 * * * *`)
- Endpoint: `/api/cron/reminders` — выбирает напоминания где `remind_at <= now()` и `status = PENDING`
- Отправка через Telegram Bot API `sendMessage`
- После отправки: status → SENT
- Напоминание создаётся автоматически при создании задачи с дедлайном (тип HARD)
- Пользователь может добавить напоминание вручную: "напомни в 18:00"

**Зависимости:** Задача 2 (БД), Задача 3 (бот)

### 8. Деплой на Vercel

**Описание:** Настройка production-деплоя.

**Шаги:**
- Vercel project setup + environment variables
- Vercel Postgres (или внешний PostgreSQL)
- Настройка webhook URL через Telegram Bot API `setWebhook`
- Vercel Cron Jobs для напоминаний
- Environment: `BOT_TOKEN`, `DATABASE_URL`, `OPENAI_API_KEY`, `WEBHOOK_URL`

**Зависимости:** Все предыдущие задачи

---

## Зависимости между задачами

```
1. Инициализация проекта
   ├── 2. PostgreSQL + ORM
   │   ├── 3. Telegram Bot → 5. Подтверждение → 6. CRUD
   │   ├── 6. CRUD
   │   └── 7. Напоминания
   ├── 4. AI-парсинг → 5. Подтверждение
   └── 8. Деплой (после всех)
```

## Критерии готовности

- [ ] Бот отвечает на `/start` и создаёт пользователя в БД
- [ ] Текстовое сообщение парсится через LLM и показывается результат с кнопками подтверждения
- [ ] Задачи создаются, отображаются списком, завершаются и удаляются
- [ ] Проекты создаются и задачи группируются по ним
- [ ] Напоминания отправляются в указанное время
- [ ] Задачи с жёсткими дедлайнами автоматически получают напоминание
- [ ] Бот задеплоен на Vercel и доступен 24/7
- [ ] Время ответа бота < 3 секунды (включая AI-парсинг)
