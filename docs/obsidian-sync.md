# Obsidian → tg-planer (git-based sync)

Этот документ описывает разовую настройку синхронизации задач из
Obsidian-vault в tg-planer. Поток:

```
Obsidian (правка чек-боксов) → obsidian-git (автокоммит) →
GitHub push → POST /api/sync/obsidian → UPSERT в tasks
```

## 1. Формат задач в vault

Поддерживаем формат Tasks-emoji ([спецификация](https://publish.obsidian.md/tasks/Reference/Task+Formats/Tasks+Emoji+Format)):

```markdown
- [ ] Починить кеш на /today 📅 2026-05-25 ⏫
- [ ] Простая задача без меток
- [x] Завершённая задача ⏫
- [ ] Чужой проект #project/intur 📅 2026-06-01
```

| Маркер | Значение |
|---|---|
| `- [ ]` / `- [x]` | TODO / DONE |
| `📅 YYYY-MM-DD` | Дедлайн |
| `⏫` / `🔼` / `🔽` | HIGH / MEDIUM / LOW |
| `#project/<slug>` | Переопределение проекта (если не задано — берётся из пути файла) |
| `<!--tgp:UUID-->` | Анкер задачи в БД tg-planer (добавляется автоматически) |

**Привязка к проекту:**
- По умолчанию задача попадает в проект, slug которого совпадает с именем
  файла. Например, файл `Проекты/Vodohod/turbo-site.md` → проект
  `turbo-site`.
- Если в строке задачи есть тег `#project/<slug>` — он перебивает значение
  по умолчанию.

## 2. Настройка vault (разово)

### 2.1. Git-репозиторий

```bash
cd /путь/к/vault
git init -b main
git add .
git commit -m "Initial commit"

# Создай private repo на GitHub (например ssopplus/obsidian-docs)
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

### 2.2. Плагин obsidian-git

1. В Obsidian: Settings → Community plugins → Browse → **Obsidian Git**
2. Включи плагин.
3. Settings → Obsidian Git:
   - **Vault backup interval (minutes):** 5
   - **Auto pull interval (minutes):** 5
   - **Commit message:** `vault sync: {{date}}`
4. Сделай тестовое изменение в любой заметке — через 5 минут должен
   появиться коммит в GitHub.

### 2.3. GitHub Personal Access Token

Создай PAT с правом `repo` (нужен и для чтения файлов, и для write-back
анкера):

1. https://github.com/settings/tokens/new
2. Note: `tg-planer vault sync`
3. Expiration: **No expiration** (или 1 год)
4. Scopes: **repo** (полностью)
5. Generate → скопируй (показывается один раз)

### 2.4. GitHub webhook

В настройках репо vault:

1. https://github.com/<owner>/<repo>/settings/hooks/new
2. **Payload URL:** `https://tg-planer.vercel.app/api/sync/obsidian`
3. **Content type:** `application/json`
4. **Secret:** сгенерируй случайную строку (например `openssl rand -hex 32`).
5. **Which events:** только **push** (Just the push event).
6. Active: ✓
7. Add webhook → GitHub отправит `ping` event для проверки.

### 2.5. Env переменные на Vercel

В Vercel → Settings → Environment Variables добавь:

| Имя | Значение | Где взять |
|---|---|---|
| `GITHUB_WEBHOOK_SECRET` | Секрет из шага 2.4 | Ты сам сгенерировал |
| `GITHUB_VAULT_TOKEN` | PAT из шага 2.3 | github.com/settings/tokens |
| `OBSIDIAN_SYNC_USER_ID` | UUID пользователя в `users` | (опционально) — если в БД один user, не нужен |

Передеплой Vercel, чтобы переменные подхватились.

## 3. Проверка

1. Открой заметку проекта в vault (например, `Проекты/Личное/tg-planer.md`).
2. Добавь строку: `- [ ] Тестовая задача из vault 📅 2026-06-15`
3. Сохрани файл (Cmd+S).
4. Подожди ~5 минут или нажми «Commit and sync» в obsidian-git вручную.
5. В Mini App: открой `tg-planer` в проектах — задача должна появиться.
6. В файле vault строка автоматически дополнится: `- [ ] Тестовая задача
   из vault 📅 2026-06-15 <!--tgp:abc-123-->`.

## 4. Идемпотентность

- Анкер `<!--tgp:UUID-->` гарантирует, что повторный push не создаст
  дубликат: эндпоинт матчит по нему.
- Коммиты с сообщением, начинающимся на `tgp-sync:` (write-back анкеров)
  игнорируются эндпоинтом, чтобы не зациклиться.
- Чек-бокс `[x]` в vault переводит задачу в `DONE`. Обратно (DONE в Mini
  App → `[x]` в vault) — пока **не** синхронизируется. Это вторая волна.

## 5. Troubleshooting

- **Webhook возвращает 401 invalid signature:** проверь, что
  `GITHUB_WEBHOOK_SECRET` в Vercel env совпадает с тем, что задан в
  GitHub-настройках вебхука.
- **Webhook возвращает 500 cannot resolve user:** в БД больше одного
  пользователя. Задай `OBSIDIAN_SYNC_USER_ID` явно.
- **Задачи не появляются, payload видно в GitHub deliveries:** проверь
  пути файлов в diff — поддерживаются только `Проекты/**/*.md`. Заметки
  в `Темы/` и `Технологии/` игнорируются.
