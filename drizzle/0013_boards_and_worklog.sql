CREATE TABLE "boards" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_inbox" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worklog_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"issue_key" text NOT NULL,
	"issue_title" text,
	"minutes" integer NOT NULL,
	"comment" text,
	"tracker_worklog_id" integer,
	"work_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "board_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worklog_entries" ADD CONSTRAINT "worklog_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boards_user_order_idx" ON "boards" USING btree ("user_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "boards_user_inbox_idx" ON "boards" USING btree ("user_id") WHERE "boards"."is_inbox";--> statement-breakpoint
CREATE INDEX "worklog_entries_user_date_idx" ON "worklog_entries" USING btree ("user_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "worklog_entries_tracker_id_idx" ON "worklog_entries" USING btree ("user_id","tracker_worklog_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;