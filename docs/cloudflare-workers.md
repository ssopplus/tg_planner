# Cloudflare Workers

С 24.11.2026 tg-planer работает на Cloudflare Workers через [OpenNext](https://opennext.js.org/cloudflare):
https://tg-planner.vpv-dev.workers.dev. До этого был Vercel Hobby — упёрлись в лимиты аккаунта.

## Деплой

```bash
pnpm cf:deploy          # сборка OpenNext + wrangler deploy
pnpm cf:preview         # локально в workerd (секреты — .dev.vars)
npx wrangler tail tg-planner   # логи
```

Секреты — `npx wrangler secret put <ИМЯ>` или пачкой `npx wrangler secret bulk <json>`; список — раздел
«Env переменные» в CLAUDE.md плюс `APP_URL` (origin воркера — для cron). Миграции БД — как раньше, GitHub Actions.

## Cron

Один триггер `* * * * *`; [cf-worker.mjs](../cf-worker.mjs) по времени UTC решает, какие `/api/cron/*` вызвать,
и вызывает их тем же обработчиком с `CRON_SECRET`. Расписание (МСК = UTC+3): reminders — каждую минуту,
pending-cleanup — 5 мин, digest и calendar-sync — 15 мин, tracker-sync — 30 мин, archive — 03:11 МСК,
coordination-poll — будни 16:00 МСК. Задачи cron-job.org отключены.

## Ловушки

- **grammY — только `grammy/web`.** Node-сборка тянет node-fetch и abort-controller, на Workers запросы к
  Telegram из неё виснут; `webhookCallback` делает `bot.init()` до проверки секрета — вебхук молчит.
- **postgres — внешний пакет Next** (`serverExternalPackages` в next.config.ts): иначе бандлится Node-сборка
  поверх эмуляции net/tls и запросы падают с `CONNECTION_CLOSED`. Внешний пакет OpenNext берёт с условием
  `workerd` (cloudflare:sockets).
- **Патч postgres-js** ([patches/postgres@3.4.8.patch](../patches/postgres@3.4.8.patch)): на серверах Cloudflare
  запись в сокет одним куском от 64 КБ рвёт соединение с пулером Supabase — режем на 16 КБ. При обновлении
  postgres перенести патч (pnpm сообщит, что он не применился). Локальный workerd обрыв не воспроизводит.
- **Подключение к БД — на каждый запрос**: сокет нельзя переиспользовать между запросами. `db` из
  [src/lib/db/index.ts](../src/lib/db/index.ts) — прокси на подключение текущего запроса.
- **Лимит бесплатного тарифа** — 3 МБ сжатого бандла (у нас ~2,5) и 10 мс CPU на запрос. Тяжёлое (PDF, разбор
  статей в «Чтении») может упереться: ошибка 1102 → тариф Workers Paid ($5).
- **Из России** Cloudflare бывает замедлен — Mini App открывать через VPN.
