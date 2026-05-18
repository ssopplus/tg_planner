# Настройка cron для tg-planer

Бесплатный план Vercel не позволяет запускать cron чаще раза в сутки.
Поэтому расписание для всех периодических задач вынесено наружу — в
[cron-job.org](https://cron-job.org). Сам код cron-эндпоинтов в проекте
остаётся без изменений.

## Эндпоинты

Все cron-роуты живут в `src/app/api/cron/*` и требуют заголовок
`Authorization: Bearer ${CRON_SECRET}`.

| Эндпоинт | Что делает | Рекомендуемая частота |
|---|---|---|
| `/api/cron/reminders` | Отправляет напоминания, у которых наступило `remind_at`. Пересоздаёт повторяющиеся (rrule). | **каждую минуту** |
| `/api/cron/digest` | Утренний и вечерний дайджест задач каждому пользователю по его `morningDigestTime` / `eveningDigestTime`. | каждые 15 минут |
| `/api/cron/pending-cleanup` | Удаляет просроченные `pending_tasks` (распарсенные AI задачи, не подтверждённые в течение 5 минут). | каждые 5 минут |
| `/api/cron/archive` | Переводит DONE-задачи старше 7 дней в `ARCHIVED`. | раз в день, 03:00 МСК |

## Шаги настройки cron-job.org

1. Зарегистрируйся на [cron-job.org](https://cron-job.org) и подтверди email.
2. В кабинете → **Cronjobs** → **Create cronjob**.
3. Для каждого из четырёх эндпоинтов выше заполни:
   - **Title** — например, `tg-planer reminders`.
   - **URL** — `https://<твой-домен>.vercel.app/api/cron/reminders`
     (заменяя путь под нужный эндпоинт).
   - **Execution schedule** — выбери частоту из таблицы.
     Для «каждой минуты» — пресет `Every minute` (или crontab `* * * * *`).
   - **Advanced → Request method** — `GET`.
   - **Advanced → Request headers**:
     - `Authorization: Bearer <значение CRON_SECRET из Vercel env>`
   - **Advanced → Notifications** — включить уведомления при `Failed`
     (придёт email когда вернётся не 2xx).
4. Сохрани и нажми **Run now** один раз — убедись, что ответ `200 OK`.

## Что должно вернуться

- `/api/cron/reminders` → `{ "ok": true, "sent": <число> }`
- `/api/cron/digest` → `{ "ok": true, "sent": <число> }`
- `/api/cron/pending-cleanup` → `{ "ok": true, "removed": <число> }`
- `/api/cron/archive` → `{ "ok": true, "archived": <число> }`

Если возвращается `401 Unauthorized` — неправильный `CRON_SECRET` в
заголовке. Если `500` — открой Vercel Logs → выбери функцию → найди
причину.

## Почему 4 отдельных job'а, а не 1 общий

Можно было сделать единый `/api/cron/tick`, который сам решает,
кого запускать по минутам. Но:
- проще отладка и логи (видно, какой именно job упал);
- разная частота — `reminders` нужны каждую минуту, остальные реже;
- если один эндпоинт начнёт тормозить — он не блокирует остальные;
- удаление одного job'а в UI не задевает другие.

## Переход обратно на Vercel Cron Pro

Если решишь перейти на платный план Vercel ($20/мес):
1. Верни секцию `crons` в [vercel.json](../vercel.json):
   ```json
   "crons": [
     { "path": "/api/cron/reminders", "schedule": "* * * * *" },
     { "path": "/api/cron/digest", "schedule": "*/15 * * * *" },
     { "path": "/api/cron/pending-cleanup", "schedule": "*/5 * * * *" },
     { "path": "/api/cron/archive", "schedule": "0 3 * * *" }
   ]
   ```
2. В cron-job.org поставь все 4 job'а на паузу.
3. Vercel автоматически добавляет правильный заголовок авторизации,
   `CRON_SECRET` проверяется в каждом роуте.

## Альтернативы (если cron-job.org перестанет работать)

- [GitHub Actions](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule) — schedule `*/5 * * * *`, фактическая задержка часто 5–10 минут;
- [Upstash QStash](https://upstash.com/docs/qstash) — 500 запросов/день бесплатно;
- [EasyCron](https://www.easycron.com) — платный, более стабильный;
- Запуск бота отдельным процессом на VPS — тогда cron-логику можно занести в `setInterval` внутри процесса, эндпоинты больше не нужны.
