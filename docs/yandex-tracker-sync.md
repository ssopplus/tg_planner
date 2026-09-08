# Yandex Tracker ↔ tg-planer

Синхронизация рабочих задач с Яндекс.Трекером. Организация — **vodohod.ru**
(Яндекс 360, числовой Org-ID `7026646`, заголовок `X-Org-ID`).

## Что делает

- Каждые 30 минут (cron-job.org) тянет активные задачи, назначенные на тебя.
- Раскладывает их по проектам согласно конфигу очередей из Obsidian-vault.
- UPSERT в `tasks` по уникальному `(user_id, external_source, external_id)`,
  где `external_source = 'yandex-tracker'`, `external_id` — ключ тикета (`POLAERP-42`).
- Подтягивает статус тикета: `inProgress`/`testing`/`intest` → `IN_PROGRESS`,
  остальные активные → `TODO`.
- Закрывает локально задачи, исчезнувшие из выборки активных (reconciliation).
- Уведомляет в личку о новых задачах (кроме самого первого синка).
- На странице задачи в Mini App показывает ссылку «Открыть в Tracker».

Обратная запись: отметка DONE в планировщике вызывает `closeIssue()` —
transition тикета в `closed`/`resolved` с `resolution: fixed`
(см. [src/app/api/tasks/[id]/route.ts](../src/app/api/tasks/[id]/route.ts)).

## Конфиг очередей: источник — Obsidian-vault

Маппинг «очередь → проект» **не хардкодится в коде**. Он живёт во frontmatter
заметки проекта `Документация/Проекты/<категория>/<slug>/index.md`:

```yaml
tracker_queues: [WEBSH, SHWEB]     # какие очереди приземляются в этот проект
tracker_default_queue: WEBSH       # куда «поднимать» внутренние задачи
```

`pnpm sync:vault` заливает это в `projects.tracker_queues` / `projects.tracker_default_queue`,
а синк строит маппинг запросом к БД. **Подключить новую очередь = дописать строку
в заметку и прогнать `pnpm sync:vault`.** Правка кода и деплой не нужны.

Ключи очередей нормализуются в верхний регистр. Если задана только
`tracker_default_queue` — она же становится единственной очередью синка.
Одна очередь у двух проектов = конфликт: берётся первый проект, в логи идёт warning.

Текущая раскладка:

| Очередь | Имя в Трекере | Проект vault |
|---|---|---|
| `POLAERP` | Пола Ерп | `pola-erp` |
| `REVENUERADAR` | Revenue Radar | `RevenueRadar` |
| `WEBSH` | WEB Swan Hellenic | `SwanHellenic` |
| `SHWEB` | SH Web Development | `SwanHellenic` |
| `VDHWEBNEW` | ВодоходЪ Сайт 2027 | `vodohod-new-site` |

Очереди без конфига (`AIBOT`, `DEV`, `SH`, …) попадают в `summary.skipped` —
это ожидаемое поведение, а не ошибка.

Плоские ключи (`tracker_queues`, а не вложенный `tracker:`) выбраны потому, что
самописный парсер frontmatter в [scripts/sync-vault-projects.ts](../scripts/sync-vault-projects.ts)
понимает inline-массивы, но не вложенные объекты.

## Фильтр активных задач: почему не `Resolution: empty()`

Раньше выборка шла по `Assignee: me() AND Resolution: empty()`. **Это неверно.**
Замер 08.09.2026 на живой орге: такой запрос вернул 10 тикетов, из которых
8 закрытых — POLAERP-2/17/28/42/55, SHWEB-144/266 и AIBOT-121 «Отменено».
Причина: тикет можно закрыть переходом без указания резолюции, тогда поле
`Resolution` остаётся пустым.

Сейчас фильтр строится исключением статусов:

```
Assignee: me() AND Status: !closed AND Status: !cancelled
                AND Status: !resolved AND Status: !rejected
```

Тот же замер с этим фильтром дал ровно **17 активных из 62** тикетов.

Поверх YQL стоит **вторая, клиентская проверка** `isActiveIssue()` по `status.key`.
Она не избыточна: поисковый индекс Трекера отдаёт неконсистентные данные — в одном
ответе POLAERP-42 приходил как «В работе», в другом как «Закрыт», а POLAERP-8/9
присутствовали в отфильтрованной выборке, но отсутствовали в полном списке тикетов.

## Reconciliation: закрытие пропавших задач

Если тикет был активным, а в очередной выборке не пришёл — он закрыт, отменён
или снят с тебя. Такая задача переводится в `DONE` локально. Границы намеренно узкие:

- **только очереди из текущего конфига** — если очередь убрали из `tracker_queues`,
  её задачи больше не опрашиваются, и «отсутствие» ничего не значит;
- **только при непустой выборке** — пустой ответ API (сбой, протухший токен) иначе
  закрыл бы разом все рабочие задачи;
- `DONE`/`ARCHIVED` не трогаются.

> **Важно.** Логика верна, только пока синк тянет **все** активные тикеты. Если
> вернуть оптимизацию `updatedSince`, выборка станет частичной, «пропавшая» задача
> перестанет означать «закрытая» — reconciliation придётся выключить.

Статус активного тикета всегда берётся из Трекера, даже если локально стоял `DONE`:
это признак того, что `closeIssue()` не сработал, и честнее показать расхождение,
чем молча разойтись с Трекером.

## Env переменные (на Vercel)

| Имя | Значение | Где взять |
|---|---|---|
| `YANDEX_TRACKER_TOKEN` | OAuth token вида `y0__...` | oauth.yandex.ru/client + право «Яндекс.Трекер», Implicit Flow |
| `YANDEX_TRACKER_ORG_ID` | `7026646` (числовой, **без** префикса `org-`) | ответ `getOrganizationFront` в DevTools на tracker.yandex.ru |
| `TRACKER_SYNC_USER_ID` | UUID пользователя в `users` (опционально, если в БД >1 user) | `SELECT id FROM users` |

Serverless вшивает env на момент деплоя — после правки переменных нужен redeploy.

## Cron-job.org

- **Title:** `tg-planer Yandex Tracker sync`
- **URL:** `https://tg-planner.vercel.app/api/cron/tracker-sync`
- **Schedule:** каждые 30 минут
- **Request method:** GET
- **Headers:** `Authorization: Bearer <CRON_SECRET>`

Проверка результата:

```sql
SELECT title, external_id, status, external_synced_at FROM tasks
 WHERE external_source = 'yandex-tracker' ORDER BY external_synced_at DESC;
```

## Troubleshooting

- **500 `tracker not configured`** — нет `YANDEX_TRACKER_TOKEN` или
  `YANDEX_TRACKER_ORG_ID`. После добавления в Vercel обязателен redeploy.
- **500 `no tracker queues configured`** — ни у одного проекта не заполнено
  `tracker_queues`. Дописать во frontmatter `index.md` и прогнать `pnpm sync:vault`.
- **500 `cannot resolve user`** — в БД больше одного пользователя, задать
  `TRACKER_SYNC_USER_ID`.
- **`summary.skipped > 0`** — задачи из очередей без конфига. Норма.
- **`summary.fetched = 0`** — Трекер не вернул активных задач: возможно, протух
  токен (Яндекс 360 инвалидирует их при смене пароля). Проверка вручную:
  ```bash
  curl -s -X POST -H "Authorization: OAuth $YANDEX_TRACKER_TOKEN" \
    -H "X-Org-ID: $YANDEX_TRACKER_ORG_ID" \
    -H "Content-Type: application/json" \
    -d '{"query":"Assignee: me() AND Status: !closed AND Status: !cancelled AND Status: !resolved"}' \
    "https://api.tracker.yandex.net/v2/issues/_search?perPage=10"
  ```
- **Задача уехала не в тот проект** — очередь указана в `tracker_queues` у двух
  проектов. Смотреть warning в логах функции, убрать лишнюю привязку.
