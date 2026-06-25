# Миграция БД: Neon → Supabase

## Контекст

Free Neon упёрся в compute-квоту, БД отключается. Профиль tg-planer
(cron каждые 5 мин + редкий пользовательский трафик) спокойно живёт
в free Supabase: 500 МБ storage, без лимита на compute-часы, есть
pgBouncer для serverless.

## Предусловия

- Аккаунт в supabase.com.
- Доступ к console.neon.tech (старая БД должна быть в рабочем состоянии
  хотя бы 10 минут на время дампа).
- Локально установлены `pg_dump`, `pg_restore` (Postgres 15+). Если нет:
  `brew install postgresql@15`.
- Все cron'ы временно остановлены (cron-job.org → паузу на 3 эндпоинта).

## Шаг 1. Создать проект в Supabase

1. supabase.com → New project.
2. Region: `eu-central-1` (Frankfurt). Ближе всего к Vercel.
3. Database Password: сгенерировать и сохранить надёжно.
4. Дождаться "Project is up" (~2 мин).
5. Settings → Database → Connection string → **Transaction mode (6543)**
   — это connection через pgBouncer для serverless.
   Формат: `postgresql://postgres.<ref>:<pwd>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true`
6. Также скопировать **Session mode (5432)** — нужен для накатывания
   миграций (pgBouncer ломает prepared statements от Drizzle).

## Шаг 2. Дамп из Neon

```bash
cd /Users/vilch/Разработка/Личное/project/tg-planer
NEON_URL=$(grep -E '^DATABASE_URL' .env | head -1 | sed 's/^DATABASE_URL="\(.*\)"$/\1/')

# Только данные (схему накатим через Drizzle migrate).
pg_dump "$NEON_URL" \
  --data-only \
  --no-owner \
  --no-privileges \
  --disable-triggers \
  --column-inserts \
  -f /tmp/tg-planer-data.sql

# Проверь размер: должно быть < 1 МБ при текущих 100 задачах.
ls -lh /tmp/tg-planer-data.sql
```

Почему `--column-inserts`: переключение между Postgres-провайдерами;
эта форма надёжнее `COPY` при разнице расширений (Supabase ставит
несколько своих по умолчанию — `pg_graphql`, `pgsodium` и т.п.).

## Шаг 3. Накатить схему на Supabase

```bash
# Session mode URL (port 5432, не 6543)
SUPABASE_SESSION='postgresql://postgres.<ref>:<pwd>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'

DATABASE_URL="$SUPABASE_SESSION" pnpm drizzle-kit migrate
```

Прогонит все миграции из `drizzle/` по очереди. Должно завершиться
без ошибок.

## Шаг 4. Залить данные

```bash
psql "$SUPABASE_SESSION" -v ON_ERROR_STOP=1 -f /tmp/tg-planer-data.sql
```

`--disable-triggers` в дампе нужен, потому что dump-файл выключает
FK-проверки на время вставки (иначе порядок INSERT'ов может ломать
ссылки между таблицами).

## Шаг 5. Проверка

```bash
psql "$SUPABASE_SESSION" -c "
  SELECT 'users' t, count(*) FROM users
  UNION ALL SELECT 'projects', count(*) FROM projects
  UNION ALL SELECT 'tasks', count(*) FROM tasks
  UNION ALL SELECT 'subtasks', count(*) FROM subtasks
  UNION ALL SELECT 'reminders', count(*) FROM reminders
  ORDER BY 1;
"
```

Цифры должны совпадать с Neon (сравни с `docs/migrate-to-supabase-counts.txt`,
который сохранится в шаге 2 — добавь команду в дамп при желании).

Проверь несколько случайных задач на содержимое:

```bash
psql "$SUPABASE_SESSION" -c "SELECT id, title, status FROM tasks LIMIT 5;"
```

## Шаг 6. Переключить Vercel

1. Vercel → Project → Settings → Environment Variables.
2. `DATABASE_URL` (Production) → новое значение = **Transaction mode (6543)**,
   с `?pgbouncer=true&connection_limit=1`:
   ```
   postgresql://postgres.<ref>:<pwd>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
   ```
3. Сохранить → Vercel перевыкатит автоматически (или нажми Redeploy).

`connection_limit=1` — потому что Vercel Functions создают по
инстансу на запрос; не нужно держать пул внутри одного коннекта.

## Шаг 7. Локальная разработка

В `.env` тоже подменить:
- Для разработки удобнее **Session mode (5432)** — позволяет prepared
  statements и Drizzle Studio.

## Шаг 8. Возобновить cron'ы

- cron-job.org → unpause три эндпоинта: `/api/cron/reminders`,
  `/api/cron/digest`, `/api/cron/archive`, `/api/cron/tracker-sync`.
- Подождать первого срабатывания каждого, проверить логи Vercel —
  не должно быть SQL-ошибок.

## Шаг 9. Удалить Neon (опционально)

Только после того, как Supabase отработал хотя бы сутки без проблем.

- console.neon.tech → проект → Settings → Delete.

## Откат

Если что-то сломалось:
1. В Vercel вернуть `DATABASE_URL` обратно на Neon-строку (она у тебя
   в `.env` сохранена).
2. Redeploy.

Neon живёт месяц, можно успеть починить.

## Сводка различий Neon ↔ Supabase

| Аспект | Neon free | Supabase free |
|---|---|---|
| Storage | 0.5 ГБ | 500 МБ |
| Compute | 191.9 ч/мес | без лимита |
| Auto-suspend | 5 мин idle | 7 дней idle |
| Pooler | встроенный | pgBouncer (порт 6543) |
| Extensions | вшитые | pg_graphql, pgsodium, vault, pg_stat_statements + ещё ~30 |
| Branches | да | нет |
| Cold start | ~300 мс | ~3 с (но у нас cron каждые 5 мин — не успевает заснуть) |
