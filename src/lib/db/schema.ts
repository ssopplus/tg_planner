import {
  pgTable,
  text,
  timestamp,
  bigint,
  boolean,
  integer,
  json,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  date,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// === ENUMS ===

export const projectTypeEnum = pgEnum('project_type', ['DEFAULT', 'SHOPPING'])
export const taskStatusEnum = pgEnum('task_status', ['TODO', 'IN_PROGRESS', 'DONE', 'ARCHIVED'])
export const priorityEnum = pgEnum('priority', ['LOW', 'MEDIUM', 'HIGH'])
export const deadlineTypeEnum = pgEnum('deadline_type', ['HARD', 'SOFT'])
export const reminderTypeEnum = pgEnum('reminder_type', ['TIME', 'BEFORE_DEADLINE'])
export const reminderStatusEnum = pgEnum('reminder_status', ['PENDING', 'SENT', 'CANCELLED'])

// === ТАБЛИЦЫ ===

export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  telegramId: bigint('telegram_id', { mode: 'bigint' }).unique().notNull(),
  username: text('username'),
  firstName: text('first_name'),
  timezone: text('timezone').default('Europe/Moscow').notNull(),
  digestTime: text('digest_time').default('09:00').notNull(),
  morningDigestTime: text('morning_digest_time').default('08:00').notNull(),
  eveningDigestTime: text('evening_digest_time').default('21:00').notNull(),
  settings: json('settings').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
})

export const projects = pgTable(
  'projects',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    /** Стабильный идентификатор для связи с vault и внешними системами */
    slug: text('slug'),
    /** Относительный путь к заметке vault, например "Проекты/Личное/tg-planer.md" */
    vaultPath: text('vault_path'),
    /** Краткое описание (из тела заметки) */
    description: text('description'),
    /** Стек технологий, секция ## Технологии заметки */
    techStack: jsonb('tech_stack'),
    /** Теги frontmatter */
    tags: jsonb('tags'),
    /** "general" (без репозитория) или "dev" (есть код, доступна генерация промтов) */
    kind: text('kind').default('general').notNull(),
    /** Абсолютный путь к репозиторию для dev-проектов. Для проектов с одним репо. */
    repoPath: text('repo_path'),
    /**
     * Массив репозиториев для мультирепо-проектов (например, pola-erp: erp+front+electron).
     * Формат: [{slug, name, path}]. Если не пуст — используется вместо repoPath.
     */
    repoPaths: jsonb('repo_paths'),
    type: projectTypeEnum('type').default('DEFAULT').notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('projects_user_id_idx').on(table.userId),
    index('projects_user_slug_idx').on(table.userId, table.slug),
  ],
)

/**
 * Связка «очередь Яндекс.Трекера → проект планировщика».
 *
 * Единственный источник истины про связки (правится на экране настроек в
 * Mini App). Во frontmatter заметок vault они больше не хранятся: два места
 * правки неизбежно расходились.
 *
 * Одна очередь может вести в несколько проектов. Разбор идёт по подстроке в
 * заголовке тикета: у очереди VDHWEBNEW («ВодоходЪ Сайт 2027») задачи интура
 * помечены префиксом «WEB Интур //», а компонентов и тегов у тикетов нет —
 * заголовок остаётся единственным машинным признаком. Поэтому:
 *  - связка с `titleFilter` срабатывает, если подстрока найдена в summary;
 *  - связка без `titleFilter` — основная для очереди, забирает всё остальное.
 */
export const trackerQueueLinks = pgTable(
  'tracker_queue_links',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Ключ очереди в верхнем регистре, например "VDHWEBNEW". */
    queueKey: text('queue_key').notNull(),
    projectId: text('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    /** Подстрока в заголовке тикета (без учёта регистра). NULL = основная связка очереди. */
    titleFilter: text('title_filter'),
    /**
     * Эта очередь предлагается по умолчанию, когда внутреннюю задачу проекта
     * «поднимают» в Трекер. У проекта осмысленна одна такая связка.
     */
    isDefaultForProject: boolean('is_default_for_project').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('tracker_queue_links_user_queue_idx').on(table.userId, table.queueKey),
    // Один и тот же фильтр в очереди дважды не имеет смысла.
    uniqueIndex('tracker_queue_links_filter_idx').on(
      table.userId,
      table.queueKey,
      table.titleFilter,
    ),
    // Основная связка у очереди одна. Индекс выше этого не гарантирует:
    // в Postgres NULL не конфликтует с NULL, поэтому нужен частичный индекс.
    uniqueIndex('tracker_queue_links_fallback_idx')
      .on(table.userId, table.queueKey)
      .where(sql`${table.titleFilter} is null`),
  ],
)

/**
 * Доска личных дел: «Дом», «Машина», «Финансы».
 *
 * Отдельная сущность, а не `projects`: проекты связаны с очередями Трекера и
 * путями в Obsidian-vault, а доска — просто область жизни с эмодзи и цветом.
 * Смешивать их в одной таблице значит тащить рабочие поля в бытовые списки.
 *
 * Колонки на доске — не статусы, а сроки (сегодня / на неделе / потом / без
 * даты), поэтому у доски нет настроек колонок: они одинаковы у всех.
 */
export const boards = pgTable(
  'boards',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    /** Эмодзи для ленты переключения досок; одного символа достаточно. */
    emoji: text('emoji'),
    /** HEX-цвет полоски карточек, например `#1f6feb`. NULL — цвет темы. */
    color: text('color'),
    sortOrder: integer('sort_order').default(0).notNull(),
    /**
     * Доска по умолчанию: сюда падают дела, для которых доска не названа
     * (быстрая запись из бота). Такая доска у пользователя одна.
     */
    isInbox: boolean('is_inbox').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('boards_user_order_idx').on(table.userId, table.sortOrder),
    // «Входящие» у пользователя одни: частичный индекс, потому что обычных
    // досок с is_inbox = false сколько угодно.
    uniqueIndex('boards_user_inbox_idx')
      .on(table.userId)
      .where(sql`${table.isInbox}`),
  ],
)

export const tasks = pgTable(
  'tasks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /**
     * Доска личных дел. NULL у задач Трекера и у задач из Obsidian-vault —
     * они живут в своих разделах и на досках не показываются.
     */
    boardId: text('board_id').references(() => boards.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    /**
     * Текст заметки личного дела: адреса, телефоны, размеры, подпункты.
     * Отдельно от `description`, куда синк кладёт описание задачи Трекера, —
     * иначе следующий прогон синка затёр бы написанное руками.
     */
    body: text('body'),
    /**
     * Срок личного дела — день без времени. Определяет колонку на доске и
     * меняется перетаскиванием карточки. Отдельно от `deadline_at`: тот
     * хранит момент со временем и обслуживает напоминания.
     */
    dueDate: date('due_date'),
    status: taskStatusEnum('status').default('TODO').notNull(),
    priority: priorityEnum('priority').default('MEDIUM').notNull(),
    deadlineAt: timestamp('deadline_at'),
    deadlineType: deadlineTypeEnum('deadline_type'),
    myDayDate: date('my_day_date'),
    myDaySortOrder: integer('my_day_sort_order'),
    /**
     * Ручное ранжирование задач в общем списке (перетаскивание в Mini App).
     * Порядок глобальный на пользователя, разделы «Трекер»/«Внутренние» —
     * фильтр поверх него: перетаскивание внутри раздела переприсваивает
     * позиции только видимым задачам (см. PATCH /api/tasks/reorder).
     * 0 у всех = ранжирования ещё не было, выдача падает на created_at.
     */
    sortOrder: integer('sort_order').default(0).notNull(),
    overdueCount: integer('overdue_count').default(0).notNull(),
    completedAt: timestamp('completed_at'),
    /** Путь к md-заметке в vault, если задача пришла из Obsidian. NULL для задач из бота/Mini App. */
    vaultPath: text('vault_path'),
    /** Источник внешней задачи: "yandex-tracker" | NULL (создана внутри tg-planer) */
    externalSource: text('external_source'),
    /** Ключ задачи во внешней системе (например, "SHWEB-264"). Уникален в паре с externalSource. */
    externalId: text('external_id'),
    /** Когда last-synced с внешней системой. Нужен для echo-suppression при двусторонней синхронизации. */
    externalSyncedAt: timestamp('external_synced_at'),
    /**
     * Последний виденный `updatedAt` тикета Трекера.
     *
     * Трекер сдвигает его на любую запись в changelog, включая добавление
     * комментария (проверено 08.10.2026 на WEBSH-413). Поэтому сравнение с
     * этим полем отвечает на вопрос «в задаче вообще что-то происходило» —
     * и комментарии дотягиваются только для шевельнувшихся задач, а не для
     * всех активных на каждом прогоне синка.
     */
    trackerUpdatedAt: timestamp('tracker_updated_at'),
    /** Id последнего комментария, о котором уже уведомили. */
    trackerLastCommentId: integer('tracker_last_comment_id'),
    /**
     * Статус тикета словами Трекера («Тестируется»), а не нашими TODO/IN_PROGRESS.
     *
     * Нужен уведомлениям: половина переходов очереди укладывается в один наш
     * статус, и «Можно тестировать → Тестируется» на стороне tg-planer
     * выглядело бы как отсутствие изменений.
     */
    trackerStatus: text('tracker_status'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('tasks_user_status_idx').on(table.userId, table.status),
    index('tasks_project_status_idx').on(table.projectId, table.status),
    index('tasks_deadline_idx').on(table.deadlineAt),
    // Уникальность по внешнему источнику: один тикет YT = одна задача в tg-planer.
    // unique(...).nullsNotDistinct() важно опустить — на nulls наоборот, чтобы внутренние
    // задачи (external_source IS NULL) могли существовать без ограничений.
    uniqueIndex('tasks_external_id_idx').on(table.userId, table.externalSource, table.externalId),
  ],
)

export const reminders = pgTable(
  'reminders',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    taskId: text('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    remindAt: timestamp('remind_at').notNull(),
    type: reminderTypeEnum('type').default('TIME').notNull(),
    status: reminderStatusEnum('status').default('PENDING').notNull(),
    rrule: text('rrule'),
    isRecurring: boolean('is_recurring').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('reminders_remind_status_idx').on(table.remindAt, table.status),
    index('reminders_user_id_idx').on(table.userId),
  ],
)

export const subtasks = pgTable(
  'subtasks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    taskId: text('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    title: text('title').notNull(),
    isCompleted: boolean('is_completed').default(false).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('subtasks_task_id_idx').on(table.taskId)],
)

/**
 * Распарсенные AI задачи, ожидающие подтверждения пользователем.
 * Раньше хранились в in-memory Map — терялись при рестарте лямбды.
 * TTL 5 минут, автоочистка через cron /api/cron/pending-cleanup.
 */
export const pendingTasks = pgTable(
  'pending_tasks',
  {
    id: text('id').primaryKey(), // короткий UUID для callback_data
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    payload: jsonb('payload').notNull(), // PendingTaskPayload (см. pending-store.ts)
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('pending_tasks_user_idx').on(table.userId),
    index('pending_tasks_expires_idx').on(table.expiresAt),
  ],
)

// === СВЯЗИ ===

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  tasks: many(tasks),
  reminders: many(reminders),
}))

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  tasks: many(tasks),
}))

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  board: one(boards, { fields: [tasks.boardId], references: [boards.id] }),
  user: one(users, { fields: [tasks.userId], references: [users.id] }),
  reminders: many(reminders),
  subtasks: many(subtasks),
}))

export const subtasksRelations = relations(subtasks, ({ one }) => ({
  task: one(tasks, { fields: [subtasks.taskId], references: [tasks.id] }),
}))

export const remindersRelations = relations(reminders, ({ one }) => ({
  task: one(tasks, { fields: [reminders.taskId], references: [tasks.id] }),
  user: one(users, { fields: [reminders.userId], references: [users.id] }),
}))

/**
 * Состояние ежедневного опроса по координации (очередь INTCOORD).
 *
 * Опрос идёт поштучно: бот спрашивает про направление, пользователь жмёт
 * кнопку с минутами, бот переходит к следующему. Ответы нельзя держать в
 * `callback_data` — там 64 байта, — поэтому состояние живёт здесь, по строке
 * на пользователя и день. Она же служит журналом: после подтверждения в
 * `answers` остаются внесённые суммы, а в `worklogIds` — id записей Трекера.
 *
 * Уникальность (user_id, poll_date) не даёт завести второй опрос за тот же
 * день: повторный вызов крона переиспользует существующую строку.
 */
export const coordinationPolls = pgTable(
  'coordination_polls',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** День, ЗА который списывается время (в таймзоне пользователя). */
    pollDate: date('poll_date').notNull(),
    /**
     * Ответы: `{ "INTCOORD-1": 30, "INTCOORD-3": 15 }`, минуты.
     * Направление, которого нет в объекте, ещё не спрошено; 0 — «не было».
     */
    answers: jsonb('answers').$type<Record<string, number>>().default({}).notNull(),
    /** Ключи направлений в порядке опроса — с ними сверяется текущий шаг. */
    steps: jsonb('steps').$type<string[]>().default([]).notNull(),
    /** Индекс текущего вопроса в `steps`; равен длине — все спрошены. */
    step: integer('step').default(0).notNull(),
    /**
     * asking — идёт опрос, confirming — показан итог, submitted — записано
     * в Трекер, skipped — пользователь сказал «сегодня не было».
     */
    status: text('status').default('asking').notNull(),
    /** Сообщение бота, которое редактируется на каждом шаге. */
    chatId: text('chat_id'),
    messageId: integer('message_id'),
    /** id внесённых записей Трекера — чтобы видеть, что именно ушло. */
    worklogIds: jsonb('worklog_ids').$type<Record<string, number>>().default({}).notNull(),
    /**
     * Что бот ждёт от пользователя следующим сообщением.
     *
     * Комментарий к записи можно не только выбрать кнопкой, но и написать
     * текстом — а текст приходит обычным сообщением, вне callback'а. Здесь
     * лежит контекст этого ожидания: за какой день, в какое направление и
     * сколько минут писать (или id записи, если правим существующую).
     * null — ничего не ждём, текст уходит обычному парсеру задач.
     */
    pendingInput: jsonb('pending_input').$type<{
      kind: 'comment-new' | 'comment-edit'
      issueKey: string
      minutes?: number
      worklogId?: number
    } | null>(),
    submittedAt: timestamp('submitted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('coordination_polls_user_date_idx').on(table.userId, table.pollDate)],
)

/**
 * Зеркало списаний времени в Яндекс.Трекере.
 *
 * Трекер остаётся источником правды: запись создаётся там, здесь сохраняется
 * её копия с `tracker_worklog_id`. Нужна, чтобы экран дня не дёргал API на
 * каждую строку — поиск по worklog'ам требует отдельного запроса с числовым
 * uid и отвечает заметно медленнее, чем выборка по индексу.
 *
 * Расхождения чинятся перечитыванием дня из Трекера: его ответ побеждает.
 */
export const worklogEntries = pgTable(
  'worklog_entries',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Ключ задачи, например `VDHWEBNEW-212`. */
    issueKey: text('issue_key').notNull(),
    /** Заголовок задачи на момент списания — чтобы не ходить за ним в API. */
    issueTitle: text('issue_title'),
    minutes: integer('minutes').notNull(),
    comment: text('comment'),
    /** id записи в Трекере. NULL только у строк, которые туда ещё не ушли. */
    trackerWorklogId: integer('tracker_worklog_id'),
    /** День, ЗА который списано время, в таймзоне пользователя. */
    workDate: date('work_date').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('worklog_entries_user_date_idx').on(table.userId, table.workDate),
    // Одна запись Трекера — одна строка здесь. Повторная синхронизация дня
    // обновляет существующую, а не плодит дубли.
    uniqueIndex('worklog_entries_tracker_id_idx').on(table.userId, table.trackerWorklogId),
  ],
)

export const boardsRelations = relations(boards, ({ one, many }) => ({
  user: one(users, { fields: [boards.userId], references: [users.id] }),
  tasks: many(tasks),
}))

export const worklogEntriesRelations = relations(worklogEntries, ({ one }) => ({
  user: one(users, { fields: [worklogEntries.userId], references: [users.id] }),
}))

/**
 * Зеркало встреч из Яндекс.Календаря (CalDAV).
 *
 * Строка — не событие, а его **экземпляр**: у повторяющейся встречи своя
 * строка на каждый день. Иначе «дейли в 11:00» было бы одной записью, и
 * отменить один вторник без остальных не получилось бы ни показать, ни
 * заметить.
 *
 * Зеркало нужно ровно для одного: сравнить то, что отдал сервер, с тем, что
 * мы уже видели, и отличить новое приглашение от переноса и от отмены.
 */
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** UID из ICS — общий у всех экземпляров серии. */
    uid: text('uid').notNull(),
    startsAt: timestamp('starts_at').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    allDay: boolean('all_day').default(false).notNull(),
    summary: text('summary').notNull(),
    location: text('location'),
    description: text('description'),
    organizer: text('organizer'),
    /** CONFIRMED | TENTATIVE | CANCELLED — статус самой встречи. */
    status: text('status').default('CONFIRMED').notNull(),
    /** Мой ответ: NEEDS-ACTION | ACCEPTED | DECLINED | TENTATIVE. */
    partstat: text('partstat').default('NEEDS-ACTION').notNull(),
    /** Адрес объекта на сервере — по нему возвращаем ответ на приглашение. */
    href: text('href').notNull(),
    etag: text('etag'),
    /** Когда уже уведомили — чтобы не слать одно и то же каждые 15 минут. */
    notifiedAt: timestamp('notified_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('calendar_events_instance_idx').on(table.userId, table.uid, table.startsAt),
    index('calendar_events_user_start_idx').on(table.userId, table.startsAt),
  ],
)

// === DEV-COCKPIT ===

/** Сессия Claude Code в снимке, который присылает локальный dev-cockpit. */
export type CockpitSessionSnapshot = {
  id: string
  name: string
  project: string
  status: 'waiting' | 'busy' | 'idle'
  /** Последняя реплика Claude, обрезанная и с замаскированными секретами. */
  lastAssistant?: string
  /** Ключ задачи Трекера из имени или ветки сессии. */
  taskKey?: string | null
  /** Задачи сессии: статус в Трекере и заметка start-task (план и запись ворклога этой сессии). */
  tasks?: CockpitTaskSnapshot[]
  /** Режим разрешений сессии (default, acceptEdits, plan, auto…) — из транскрипта или запроса. */
  permissionMode?: string | null
  /** Чего ждёт сессия, если это не запрос (например, фоновая стоит на вопросе в терминале). */
  waitingFor?: string | null
  /** Фоновая сессия (`claude --bg`): в VS Code её открывает только «Перенести в VS Code». */
  background?: boolean
  /** Сессия своё сделала — следующая задача из плана проекта, которую можно взять. */
  next?: { key: string; summary: string } | null
  /** Задача закрыта в Трекере, план заметки выполнен, сессия ничего не ждёт — можно закрыть. */
  closable?: boolean
  updatedAt: string
}

export type CockpitTaskSnapshot = {
  issue: string | null
  title: string
  status?: { display: string; type: string | null } | null
  todo: { done: boolean; text: string }[]
  /** Запись ворклога этой сессии, а если её нет — последняя. */
  log?: { date: string; own: boolean; done?: string; left?: string; blockers?: string } | null
}

/** Задача Трекера в плане dev-cockpit — то, что нужно строке списка, без описания. */
export type CockpitPlanIssue = {
  key: string
  summary: string
  status: { display: string; type: string | null } | null
  resolved: boolean
  priority: string | null
  type: string | null
  assignee: string | null
  deadline: string | null
  updatedAt: string | null
}

/**
 * План dev-cockpit — очерёдность задач по проектам. `plan` — ключи по порядку,
 * `issues` — задачи плана и мои открытые задачи очередей проекта (из них план
 * пополняют). `notes` — прогресс заметок start-task по ключу.
 */
export type CockpitPlanSnapshot = {
  version: number
  projects: {
    project: string
    plan: string[]
    issues: CockpitPlanIssue[]
    total: number
    error: string | null
  }[]
  notes: Record<string, { done: number; total: number; next: string | null }>
}

/**
 * Последний снимок сессий dev-cockpit — одна строка на пользователя.
 *
 * Cockpit живёт на рабочей машине и сам ходит в `/api/cockpit/sync`; входящих
 * соединений на машину нет. Снимок перезаписывается целиком, по нему экран
 * «Сессии» в Mini App.
 * Переписка и diff сюда не попадают — они остаются только в локальном cockpit.
 */
export const cockpitState = pgTable('cockpit_state', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessions: jsonb('sessions').$type<CockpitSessionSnapshot[]>().default([]).notNull(),
  /** План задач; правки из Mini App ложатся сюда сразу и уходят в cockpit командой plan-set. */
  plan: jsonb('plan').$type<CockpitPlanSnapshot>(),
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
})

/**
 * Запрос сессии Claude Code, который ждёт ответа: разрешение на инструмент
 * или вопрос `AskUserQuestion`.
 *
 * id выдаёт cockpit. Решение из Mini App ложится в `decision`, cockpit забирает
 * его следующим синком и отдаёт хуку. Побеждает первый ответ: если запрос уже
 * закрыт в cockpit или в VS Code, cockpit присылает финальный статус.
 * Хранится не дольше 7 дней.
 */
export const cockpitRequests = pgTable(
  'cockpit_requests',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    sessionId: text('session_id').notNull(),
    sessionName: text('session_name').notNull(),
    project: text('project'),
    /** permission | question */
    kind: text('kind').notNull(),
    toolName: text('tool_name').notNull(),
    /** Однострочное описание для списка; секреты замаскированы. */
    summary: text('summary').notNull(),
    /**
     * Полный вход инструмента (секреты замаскированы) — SQL и команды должны
     * быть видны целиком до «Разрешить». Для вопроса — `{ questions }`.
     */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** Можно ли ответить «Разрешить всегда» — у запроса есть suggestions. */
    canAlways: boolean('can_always').default(false).notNull(),
    /** pending | answered | answered-elsewhere | expired */
    status: text('status').default('pending').notNull(),
    /** Решение из Mini App: `{ behavior, message?, always?, answers?, setMode? }`. */
    decision: jsonb('decision').$type<{
      behavior: 'allow' | 'deny'
      message?: string
      always?: boolean
      answers?: Record<string, string>
      /** Переключить режим сессии вместе с ответом. */
      setMode?: string
    } | null>(),
    /** Когда cockpit забрал решение — до этого оно ещё не дошло до сессии. */
    deliveredAt: timestamp('delivered_at'),
    /**
     * Напоминание бота о запросе (`lib/cockpit/notify.ts`): уходит, только если запрос
     * ждёт дольше 10 мин, а к Маку столько же не прикасались. Когда запрос закрыт,
     * сообщение удаляется, колонки обнуляются.
     */
    chatId: text('chat_id'),
    messageId: integer('message_id'),
    createdAt: timestamp('created_at').notNull(),
    answeredAt: timestamp('answered_at'),
  },
  (table) => [
    index('cockpit_requests_user_status_idx').on(table.userId, table.status),
    index('cockpit_requests_created_idx').on(table.createdAt),
  ],
)

/**
 * Команды из Mini App для локального dev-cockpit: написать в сессию или
 * запустить задачу в новой фоновой сессии Claude Code.
 *
 * Cockpit забирает pending-команды синком (status → sent), выполняет их на
 * машине и следующим синком присылает итог (done / failed). Хранятся 7 дней,
 * вместе с запросами.
 */
export const cockpitCommands = pgTable(
  'cockpit_commands',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** message — текст в сессию; start-task — `claude --bg "/start-task КЛЮЧ"`; plan-set — порядок задач проекта. */
    kind: text('kind').notNull(),
    /** Сессия-адресат для message. */
    sessionId: text('session_id'),
    /**
     * message: `{ text, images?, imageCount? }`; start-task: `{ issueKey, title }`;
     * plan-set: `{ project, keys }`.
     * `images` — скрины `{ mime, data }` (base64) до доставки: cockpit сохраняет их
     * файлами, после итога синк их вычищает, остаётся только `imageCount`.
     */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** pending | sent | done | failed */
    status: text('status').default('pending').notNull(),
    /** Итог от cockpit: ошибка или вывод `claude --bg` (id фоновой сессии). */
    result: jsonb('result').$type<{ error?: string; output?: string } | null>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    sentAt: timestamp('sent_at'),
    doneAt: timestamp('done_at'),
  },
  (table) => [index('cockpit_commands_user_status_idx').on(table.userId, table.status)],
)

/** Элемент переписки сессии для Mini App: реплики целиком, действия Claude — одной строкой. */
export type CockpitChatItem =
  | { kind: 'user'; ts: number | null; text: string; via?: 'cockpit' | 'peer' }
  | { kind: 'assistant'; ts: number | null; text: string }
  | { kind: 'tool'; ts: number | null; name: string; summary: string; isError?: boolean }

/**
 * Хвост переписки сессии, которую сейчас смотрят в Mini App.
 *
 * Переписка с машины уходит только по запросу: Mini App, открывая сессию,
 * ставит `watched_at`, cockpit видит это в ответе синка и, пока сессию
 * смотрят (30 с с последнего опроса), присылает последние ~100 сообщений —
 * без входов и вывода инструментов, с замаскированными секретами. Копия одна
 * и перезаписывается; строка удаляется через час после того, как смотреть
 * перестали.
 */
export const cockpitTranscripts = pgTable('cockpit_transcripts', {
  sessionId: text('session_id').primaryKey(),
  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  items: jsonb('items').$type<CockpitChatItem[]>().default([]).notNull(),
  /** Последний опрос из Mini App — пока свежий, cockpit присылает переписку. */
  watchedAt: timestamp('watched_at').defaultNow().notNull(),
  /** Когда cockpit прислал переписку; null — ещё ни разу. */
  updatedAt: timestamp('updated_at'),
})

// === ТЕМП ЧТЕНИЯ ===

/**
 * Свои тексты для тренажёра чтения: вставленные, из файла, по ссылке, из бота,
 * с Хабра. Встроенные тексты сюда не пишутся — они в бандле
 * (`src/lib/reading/content/texts.json`). Абзацы в `body` разделены пустой строкой.
 */
export const readingTexts = pgTable(
  'reading_texts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** ru | en */
    lang: text('lang').notNull(),
    /** B1 | B2 | C1 — для английских текстов, оценивается при загрузке. */
    level: text('level'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    wordCount: integer('word_count').notNull(),
    /** paste | file | url | bot | habr | ai */
    source: text('source').default('paste').notNull(),
    /** Адрес статьи для текстов по ссылке и с Хабра — по нему не заводим дубль. */
    sourceUrl: text('source_url'),
    /**
     * Книга или длинная статья, нарезанная на части по 400–800 слов: общее
     * название и номер части. Импорт из файла и по ссылке всегда ставит
     * `part`/`parts` (у короткого текста 1 из 1) — иначе уникальный индекс по
     * ссылке не ловил бы дубль: NULL в Postgres не равен NULL. У вставленного
     * текста все три поля пустые.
     */
    collection: text('collection'),
    part: integer('part'),
    parts: integer('parts'),
    glossary: jsonb('glossary').$type<Record<string, string>>(),
    questions: jsonb('questions').$type<{ q: string; options: string[]; answer: number }[]>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('reading_texts_user_lang_idx').on(table.userId, table.lang),
    // Ссылка уникальна в пределах части: длинная статья по ссылке режется на несколько.
    uniqueIndex('reading_texts_user_source_url_idx')
      .on(table.userId, table.sourceUrl, table.part)
      .where(sql`${table.sourceUrl} is not null`),
  ],
)

/**
 * Тренировки. `day` — локальная дата пользователя (по ней считаются серия
 * дней и отметки плана), поэтому хранится отдельно от `created_at`.
 */
export const readingSessions = pgTable(
  'reading_sessions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** rsvp | pacer | silent | test | read_en | cards */
    type: text('type').notNull(),
    lang: text('lang').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    wpm: integer('wpm'),
    /** Понимание, 0–100. */
    comp: integer('comp'),
    ms: integer('ms'),
    /** id текста: встроенного (`b1`, `e3`) или из `reading_texts` — поэтому без FK. */
    textId: text('text_id'),
    title: text('title'),
    /** Сколько карточек повторено. */
    cardsReviewed: integer('cards_reviewed'),
    /** Сколько слов добавлено в карточки. */
    wordsSaved: integer('words_saved'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('reading_sessions_user_day_idx').on(table.userId, table.day),
    index('reading_sessions_user_type_idx').on(table.userId, table.type, table.lang),
  ],
)

/**
 * Карточки английских слов для интервального повторения. `box` — ступень
 * Лейтнера 0–7, интервалы [0,1,3,7,14,30,60,120] дней.
 */
export const readingCards = pgTable(
  'reading_cards',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Словарная форма. */
    en: text('en').notNull(),
    ru: text('ru').notNull(),
    /** Предложение, в котором встретилось слово. */
    ctx: text('ctx').default('').notNull(),
    /** Встреченные словоформы — по ним подчёркиваются уже сохранённые слова. */
    forms: jsonb('forms').$type<string[]>().default([]).notNull(),
    box: integer('box').default(0).notNull(),
    dueAt: timestamp('due_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('reading_cards_user_en_idx').on(table.userId, table.en),
    index('reading_cards_user_due_idx').on(table.userId, table.dueAt),
  ],
)

/**
 * Кэш переводов слов через LLM, общий для всех: ключ — словоформа в нижнем
 * регистре. Контекст предложения влияет на перевод, но повторный запрос того же
 * слова дешевле переспросить вручную, чем платить за каждый клик.
 */
export const readingTranslations = pgTable('reading_translations', {
  word: text('word').primaryKey(),
  base: text('base').notNull(),
  ru: text('ru').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
