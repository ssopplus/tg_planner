ALTER TABLE "reminders" ADD COLUMN "rrule" text;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "is_recurring" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "my_day_date" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "overdue_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "morning_digest_time" text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "evening_digest_time" text DEFAULT '21:00' NOT NULL;