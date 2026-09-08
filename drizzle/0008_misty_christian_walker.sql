ALTER TABLE "projects" ADD COLUMN "tracker_queues" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "tracker_default_queue" text;