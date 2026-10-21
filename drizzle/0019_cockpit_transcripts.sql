CREATE TABLE "cockpit_transcripts" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"watched_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "cockpit_transcripts" ADD CONSTRAINT "cockpit_transcripts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;