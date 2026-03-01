import {
  pgTable,
  text,
  timestamp,
  bigint,
  boolean,
  integer,
  json,
  pgEnum,
  index,
  date,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

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
    type: projectTypeEnum('type').default('DEFAULT').notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('projects_user_id_idx').on(table.userId)],
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
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatusEnum('status').default('TODO').notNull(),
    priority: priorityEnum('priority').default('MEDIUM').notNull(),
    deadlineAt: timestamp('deadline_at'),
    deadlineType: deadlineTypeEnum('deadline_type'),
    myDayDate: date('my_day_date'),
    myDaySortOrder: integer('my_day_sort_order'),
    overdueCount: integer('overdue_count').default(0).notNull(),
    completedAt: timestamp('completed_at'),
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
