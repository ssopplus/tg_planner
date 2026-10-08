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
