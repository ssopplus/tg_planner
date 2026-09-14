CREATE TABLE "coordination_polls" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"poll_date" date NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'asking' NOT NULL,
	"chat_id" text,
	"message_id" integer,
	"worklog_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coordination_polls" ADD CONSTRAINT "coordination_polls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coordination_polls_user_date_idx" ON "coordination_polls" USING btree ("user_id","poll_date");