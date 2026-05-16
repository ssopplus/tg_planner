ALTER TABLE "projects" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "vault_path" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "tech_stack" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "kind" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repo_path" text;--> statement-breakpoint
CREATE INDEX "projects_user_slug_idx" ON "projects" USING btree ("user_id","slug");