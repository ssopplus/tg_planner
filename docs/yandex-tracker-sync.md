# Yandex Tracker → tg-planer (F1: pull-only)

Первая фаза интеграции с Yandex Tracker. Что делает:

- Каждые 30 минут (через cron-job.org) тянет твои активные задачи из YT
  (`assignee = me() AND Resolution = empty()`).
- Маппит ключи очередей на slug проектов в БД.
- UPSERT-ит в `tasks` по уникальному `(user_id, external_source,
  external_id)`. external_source = `yandex-tracker`, external_id =
  ключ тикета вида `SHWEB-264`.
- На странице задачи в Mini App показывает ссылку «Открыть в Tracker».

## Что **НЕ** делает (F2 — следующая фаза)

- Не пушит изменения из tg-planer обратно в YT (закрытие, комментарии, перенос дедлайна).
- Не закрывает задачи в tg-planer, когда тикет закрыт в YT. После
  закрытия в YT тикет просто перестаёт попадать в выдачу `_search`,
  и обновления к нему не приходят. Чтобы закрыть в tg-planer — нажми
  «Готово» в Mini App.
- Не синхронизирует комментарии и подзадачи (checklist YT).

## Маппинг очередей → проектов

Согласовано 2026-06-03:

| YT очередь | Имя | → проект vault (slug) |
|---|---|---|
| `SHWEB` | SH Web Development | `turbo-site` |
| `POLAERP` | Pola ERP | `erp` |

Остальные очереди (`DEV`, `MARKETING`, `AIBOT`, …) пока не синкаются —
там у пользователя 0 активных задач. Добавить новые: правка
`QUEUE_TO_PROJECT_SLUG` в [src/lib/tracker/client.ts](../src/lib/tracker/client.ts).

## Env переменные (на Vercel)

| Имя | Значение | Где взять |
|---|---|---|
| `YANDEX_TRACKER_TOKEN` | OAuth token вида `y0_AgAA...` | oauth.yandex.ru/client + scope «Яндекс Трекер» |
| `YANDEX_TRACKER_ORG_ID` | `org-XXXXXX` | DevTools → запрос к api.tracker.yandex.net → заголовок X-Org-ID |
| `TRACKER_SYNC_USER_ID` | UUID пользователя в `users` (опционально, если в БД >1 user) | `SELECT id FROM users` |

## Cron-job.org

Создать запись:

- **Title:** `tg-planer Yandex Tracker sync`
- **URL:** `https://tg-planer.vercel.app/api/cron/tracker-sync`
- **Schedule:** каждые **30 минут**
- **Request method:** GET
- **Headers:** `Authorization: Bearer <CRON_SECRET>` (тот же, что для остальных cron'ов)

После запуска первого вызова в БД должны появиться задачи с
`external_source = 'yandex-tracker'`. Проверка:

```sql
SELECT title, external_id, external_synced_at FROM tasks
 WHERE external_source = 'yandex-tracker' ORDER BY external_synced_at DESC;
```

## Что покажет Mini App

- Задача с external_id появляется в проекте `turbo-site` или `erp` рядом
  с обычными задачами.
- На странице деталей сверху — синий бейдж со ссылкой `SHWEB-264 → Yandex Tracker`,
  тап открывает тикет в браузере.

## Troubleshooting

- **500 `tracker not configured`** — нет `YANDEX_TRACKER_TOKEN` или
  `YANDEX_TRACKER_ORG_ID` в Vercel env. Не забыть передеплоить после
  добавления.
- **500 `cannot resolve user`** — в БД больше одного пользователя.
  Задать `TRACKER_SYNC_USER_ID` явно.
- **summary.skipped > 0** — задача из очереди, для которой нет маппинга.
  Добавить запись в `QUEUE_TO_PROJECT_SLUG`, либо принять как
  ожидаемое поведение.
- **summary.fetched = 0** — YT не возвращает активных задач. Может быть
  токен протух (Yandex 360 иногда инвалидирует), либо `Resolution: empty()`
  отфильтровал всё. Проверить вручную:
  ```bash
  curl -s -X POST -H "Authorization: OAuth $YANDEX_TRACKER_TOKEN" \
    -H "X-Org-ID: $YANDEX_TRACKER_ORG_ID" \
    -H "Content-Type: application/json" \
    -d '{"query":"Assignee: me() AND Resolution: empty()"}' \
    "https://api.tracker.yandex.net/v2/issues/_search?perPage=10"
  ```
