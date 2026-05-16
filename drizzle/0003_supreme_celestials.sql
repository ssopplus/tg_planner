CREATE TABLE "pending_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_tasks" ADD CONSTRAINT "pending_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_tasks_user_idx" ON "pending_tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pending_tasks_expires_idx" ON "pending_tasks" USING btree ("expires_at");