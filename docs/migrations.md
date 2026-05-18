# Миграции БД

Используется Drizzle Kit. Файлы — в [`drizzle/`](../drizzle/).
Источник истины схемы — [`src/lib/db/schema.ts`](../src/lib/db/schema.ts).

## Локально (dev)

```bash
# Сгенерировать миграцию по diff'у schema.ts ↔ snapshot
pnpm db:generate

# Применить миграции к локальной БД (Docker compose, порт 5433)
pnpm db:migrate

# UI для дев-БД
pnpm db:studio
```

## Прод (Neon)

В прод миграции накатываются **только через GitHub Actions**, никогда руками.

### Настройка (разово)

1. GitHub → репозиторий → Settings → Environments → **New environment** → `production`.
2. В environment `production` → **Add secret**:
   - Name: `DATABASE_URL`
   - Value: значение из Vercel → Settings → Environment Variables → `DATABASE_URL` (Production).
3. Опционально: в Environments → `production` включить **Required reviewers**, чтобы каждый запуск требовал апрува.

### Как накатить

Способ 1 — **автоматически**: пушнуть в `main` любые изменения в `drizzle/` → workflow [`db-migrate.yml`](../.github/workflows/db-migrate.yml) сработает сам.

Способ 2 — **вручную**: GitHub → Actions → **DB migrate (prod)** → **Run workflow** → выбрать ветку `main` → Run.

### Что произойдёт

Workflow выполнит `pnpm db:migrate`, который применит все миграции из `drizzle/*.sql`, ещё не отмеченные в служебной таблице `__drizzle_migrations`. Уже накатанные пропускаются (идемпотентно).

Логи доступны во вкладке Actions → выбранный run.

## Если миграция уехала, но Vercel ещё не передеплоен

Это нормально. Сначала — миграция, потом редеплой Vercel со свежим кодом, который ожидает новых полей/таблиц. Порядок:

1. Push в `main` (или Run workflow вручную) → миграция уходит на Neon.
2. Vercel автоматически деплоит из `main` параллельно.
3. Если у тебя был **активный** деплой со старой схемой — он продолжает работать благодаря аддитивности миграций (новые колонки nullable, новые таблицы только мы знаем). Сломаться может, только если миграция удаляет колонку, которую старый код ещё читает.

## Что НЕ делать

- Не запускать `pnpm db:migrate` локально с прод-`DATABASE_URL` (по правилу в [CLAUDE.md](../../../../CLAUDE.md): прод только через CI).
- Не редактировать уже применённые .sql-файлы. Если нужно что-то поправить — генерировать новую миграцию через `pnpm db:generate`.
- Не запускать `drizzle-kit push` на прод (это перетирает схему без миграционной истории).

## Текущая история миграций

| Файл | Что делает |
|---|---|
| `0000_simple_morlun.sql` | Стартовая схема: users, projects, tasks, reminders, subtasks |
| `0001_next_roughhouse.sql` | Доработки |
| `0002_boring_red_hulk.sql` | Доработки |
| `0003_supreme_celestials.sql` | Таблица `pending_tasks` (jsonb-payload, TTL 5 мин) — переезд in-memory pending-store в Postgres |
| `0004_freezing_nick_fury.sql` | Расширение `projects`: slug, vault_path, description, tech_stack, tags, kind, repo_path + индекс (user_id, slug) — для синхронизации с Obsidian-vault |
