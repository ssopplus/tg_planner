ALTER TABLE "tasks" ADD COLUMN "tracker_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "tracker_last_comment_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "tracker_status" text;