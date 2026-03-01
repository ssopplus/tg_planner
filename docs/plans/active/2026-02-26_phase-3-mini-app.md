# Phase 3 — Mini App

## Metadata

- **Date**: 2026-02-26
- **Status**: Completed
- **Complexity**: High
- **Progress**: 100%

## Контекст

Третья фаза развития TG Planer (см. [docs/DOMAIN.md](../../DOMAIN.md)). Полноценный визуальный интерфейс через Telegram Mini App: просмотр задач, планирование дня с drag-n-drop, подзадачи с прогрессом и архив. UI дополняет чат-интерфейс бота.

### Вопросы и ответы

**Q:** Какой UI-фреймворк?
**A:** shadcn/ui + Tailwind CSS — гибкие компоненты, адаптация под Telegram тему.

**Q:** Какая библиотека для drag-n-drop?
**A:** @dnd-kit/core + @dnd-kit/sortable — лёгкая, touch-friendly, хорошая поддержка мобильных.

**Q:** Как авторизовать пользователя в Mini App?
**A:** Telegram WebApp.initData → серверная валидация HMAC подписи.

## Решение

Telegram Mini App на базе существующего Next.js приложения. Отдельная группа маршрутов `(mini-app)` с layout для Telegram WebApp SDK. shadcn/ui компоненты с адаптацией цветов под Telegram themeParams. REST API для CRUD операций. @dnd-kit для drag-n-drop сортировки в "Мой день".

### Альтернативы

1. **Отдельное React-приложение (Vite)** — два проекта вместо одного, дублирование типов и логики
2. **Telegram UI Kit вместо shadcn** — менее гибкий, ограниченный набор компонентов
3. **React DnD вместо @dnd-kit** — тяжелее, хуже поддержка touch-устройств

## Задачи

### Фаза 1: Инфраструктура Mini App
- [x] Настроить Telegram Mini App: WebApp SDK init, layout для `(mini-app)` маршрутов
- [x] Реализовать серверную валидацию initData (HMAC)
- [x] Настроить middleware авторизации для API routes
- [x] Реализовать передачу initData через HTTP заголовок
- [x] Настроить shadcn/ui + Tailwind CSS
- [x] Адаптировать тему: маппинг Telegram themeParams → CSS переменные

### Фаза 2: Навигация и компоненты
- [x] Реализовать нижнюю навигацию (Мой день / Задачи / Проекты / Настройки)
- [x] Реализовать header с Telegram BackButton
- [x] Создать компонент TaskCard (название, приоритет, дедлайн, прогресс подзадач)
- [x] Создать компонент TaskList (список с группировкой)
- [x] Создать компонент ProjectCard

### Фаза 3: Страница "Мой день"
- [x] Реализовать страницу `/today` — список задач "Моего дня"
- [x] Интегрировать @dnd-kit для drag-n-drop сортировки
- [x] Реализовать API: GET/PATCH для /api/today
- [x] Добавить свайп-действия: влево — завершить, вправо — убрать из дня
- [x] Pull-to-refresh

### Фаза 4: Задачи и проекты
- [x] Реализовать страницу `/tasks` — все задачи с фильтрами
- [x] Реализовать сортировку: по дате, дедлайну, приоритету
- [x] Реализовать FAB для быстрого создания задачи
- [x] Реализовать страницу `/projects` — список проектов с количеством задач
- [x] Реализовать страницу `/projects/[id]` — задачи проекта
- [x] Реализовать создание/удаление проектов

### Фаза 5: Детали задачи и подзадачи
- [x] Реализовать страницу `/tasks/[id]` — полный просмотр задачи
- [x] Создать таблицу subtasks (миграция): id, task_id, title, is_completed, sort_order
- [x] Реализовать чеклист подзадач с прогресс-баром
- [x] API: CRUD для /api/tasks/:id/subtasks и /api/subtasks/:id

### Фаза 6: Настройки и архив
- [x] Реализовать страницу `/settings` — timezone, время дайджестов
- [x] Автоопределение timezone из браузера
- [x] Реализовать страницу `/archive` — завершённые задачи с поиском
- [x] Pagination для архива
- [x] Реализовать восстановление задачи из архива
- [x] Cron автоархивации: DONE > 7 дней → ARCHIVED

## Затронутые файлы

- `src/app/(mini-app)/layout.tsx` — новый: Mini App layout + WebApp SDK
- `src/app/(mini-app)/today/page.tsx` — новый: страница "Мой день"
- `src/app/(mini-app)/tasks/page.tsx` — новый: список задач
- `src/app/(mini-app)/tasks/[id]/page.tsx` — новый: детали задачи
- `src/app/(mini-app)/projects/page.tsx` — новый: проекты
- `src/app/(mini-app)/settings/page.tsx` — новый: настройки
- `src/app/(mini-app)/archive/page.tsx` — новый: архив
- `src/components/ui/` — shadcn компоненты
- `src/components/tasks/` — новый: TaskCard, TaskList, TaskDetail, TaskForm
- `src/components/projects/` — новый: ProjectCard, ProjectList
- `src/components/layout/` — новый: NavBar, Header
- `src/lib/telegram/webapp.ts` — новый: WebApp SDK утилиты
- `src/lib/telegram/auth.ts` — новый: валидация initData
- `src/app/api/tasks/route.ts` — новый: REST API задач
- `src/app/api/projects/route.ts` — новый: REST API проектов
- `src/app/api/today/route.ts` — новый: REST API "Мой день"
- `src/lib/db/schema.ts` — миграция: таблица subtasks, поле my_day_sort_order
- `src/components/tasks/swipeable-task-card.tsx` — новый: карточка со свайп-действиями
- `src/components/ui/pull-to-refresh.tsx` — новый: pull-to-refresh компонент
- `src/app/api/cron/archive/route.ts` — новый: cron автоархивации (раз в день)
- `vercel.json` — обновлён: добавлен cron для автоархивации

## Последствия

### Позитивные
- Полноценный визуальный интерфейс без выхода из Telegram
- Drag-n-drop для планирования — удобнее чем текстовые команды
- Подзадачи с прогрессом дают ощущение движения
- Единая кодовая база (Next.js) для бота и Mini App

### Риски
- Telegram Mini App ограничения: размер окна, производительность на старых устройствах
- shadcn/ui темизация может не идеально соответствовать Telegram UI
- @dnd-kit на мобильных: нужно тестировать touch-взаимодействие

### Технический долг
- Нет оптимистичных обновлений UI (добавить позже)
- Нет offline-режима
- Нет E2E тестов для Mini App

## Тестирование

- Mini App открывается из бота, авторизация проходит
- Тема адаптируется при переключении light/dark в Telegram
- Drag-n-drop работает плавно на мобильных (iOS, Android)
- Подзадачи создаются, отмечаются, прогресс обновляется
- Архив показывает завершённые задачи с поиском
- Навигация через BackButton и нижнюю панель без сбоев
- Загрузка Mini App < 1 секунды

## Документация

- [x] README.md — обновлена структура проекта
- [x] CLAUDE.md — добавлены маршруты Mini App, REST API, компоненты
