CREATE TABLE "cockpit_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"session_id" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"done_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "cockpit_commands" ADD CONSTRAINT "cockpit_commands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cockpit_commands_user_status_idx" ON "cockpit_commands" USING btree ("user_id","status");