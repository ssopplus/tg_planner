ALTER TABLE "tasks" ADD COLUMN "external_source" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "external_synced_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_external_id_idx" ON "tasks" USING btree ("user_id","external_source","external_id");