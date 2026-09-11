CREATE TABLE "tracker_queue_links" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"queue_key" text NOT NULL,
	"project_id" text NOT NULL,
	"title_filter" text,
	"is_default_for_project" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracker_queue_links" ADD CONSTRAINT "tracker_queue_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_queue_links" ADD CONSTRAINT "tracker_queue_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tracker_queue_links_user_queue_idx" ON "tracker_queue_links" USING btree ("user_id","queue_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tracker_queue_links_filter_idx" ON "tracker_queue_links" USING btree ("user_id","queue_key","title_filter");--> statement-breakpoint
CREATE UNIQUE INDEX "tracker_queue_links_fallback_idx" ON "tracker_queue_links" USING btree ("user_id","queue_key") WHERE "tracker_queue_links"."title_filter" is null;--> statement-breakpoint
-- Перенос существующих связок из projects.tracker_queues до удаления колонок.
-- Раскрываем массив очередей: каждая очередь становится основной связкой
-- (title_filter IS NULL), а tracker_default_queue помечает связку, которую
-- предлагать при «поднятии» внутренней задачи в Трекер.
INSERT INTO "tracker_queue_links" ("id", "user_id", "queue_key", "project_id", "title_filter", "is_default_for_project")
SELECT
  gen_random_uuid()::text,
  p."user_id",
  upper(q.value::text),
  p."id",
  NULL,
  upper(q.value::text) = upper(coalesce(p."tracker_default_queue", ''))
FROM "projects" p
CROSS JOIN LATERAL jsonb_array_elements_text(p."tracker_queues") AS q(value)
WHERE p."tracker_queues" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "tracker_queues";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "tracker_default_queue";