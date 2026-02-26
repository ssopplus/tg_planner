# Phase 3 — Mini App

## Metadata

- **Date**: 2026-02-26
- **Status**: Planning
- **Complexity**: High
- **Progress**: 0%

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
- [ ] Настроить Telegram Mini App: WebApp SDK init, layout для `(mini-app)` маршрутов
- [ ] Реализовать серверную валидацию initData (HMAC)
- [ ] Настроить middleware авторизации для API routes
- [ ] Реализовать передачу initData через HTTP заголовок
- [ ] Настроить shadcn/ui + Tailwind CSS
- [ ] Адаптировать тему: маппинг Telegram themeParams → shadcn CSS переменные

### Фаза 2: Навигация и компоненты
- [ ] Реализовать нижнюю навигацию (Мой день / Задачи / Проекты / Настройки)
- [ ] Реализовать header с Telegram BackButton
- [ ] Создать компонент TaskCard (название, приоритет, дедлайн, прогресс подзадач)
- [ ] Создать компонент TaskList (список с группировкой)
- [ ] Создать компонент ProjectCard

### Фаза 3: Страница "Мой день"
- [ ] Реализовать страницу `/today` — список задач "Моего дня"
- [ ] Интегрировать @dnd-kit для drag-n-drop сортировки
- [ ] Реализовать API: GET/PATCH/POST/DELETE для /api/today
- [ ] Добавить свайп-действия: влево — завершить, вправо — убрать из дня
- [ ] Реализовать кнопку "Добавить задачу в день"
- [ ] Pull-to-refresh

### Фаза 4: Задачи и проекты
- [ ] Реализовать страницу `/tasks` — все задачи с фильтрами (проект, статус, приоритет)
- [ ] Реализовать сортировку: по дате, дедлайну, приоритету
- [ ] Реализовать FAB для быстрого создания задачи (bottom sheet с формой)
- [ ] Реализовать страницу `/projects` — список проектов с количеством задач
- [ ] Реализовать страницу `/projects/[id]` — задачи проекта
- [ ] Реализовать создание/редактирование/удаление проектов

### Фаза 5: Детали задачи и подзадачи
- [ ] Реализовать страницу `/tasks/[id]` — полный просмотр и редактирование задачи
- [ ] Inline-edit для названия, textarea для описания
- [ ] Select для проекта, приоритета; date/time picker для дедлайна
- [ ] Создать таблицу subtasks (миграция): id, task_id, title, is_completed, sort_order
- [ ] Реализовать чеклист подзадач с прогресс-баром ("3 из 7")
- [ ] Drag-n-drop для переупорядочивания подзадач
- [ ] API: CRUD для /api/tasks/:id/subtasks

### Фаза 6: Настройки и архив
- [ ] Реализовать страницу `/settings` — timezone, время дайджестов, проект по умолчанию
- [ ] Автоопределение timezone из браузера
- [ ] Реализовать страницу `/archive` — завершённые задачи с фильтрацией и поиском
- [ ] Infinite scroll / pagination для архива
- [ ] Реализовать восстановление задачи из архива
- [ ] Cron автоархивации: DONE > 7 дней → ARCHIVED

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

- [ ] README.md — добавить раздел про Mini App, настройку WebApp
- [ ] CLAUDE.md — описать структуру маршрутов Mini App
