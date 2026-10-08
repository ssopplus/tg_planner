CREATE TABLE "calendar_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"uid" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"summary" text NOT NULL,
	"location" text,
	"description" text,
	"organizer" text,
	"status" text DEFAULT 'CONFIRMED' NOT NULL,
	"partstat" text DEFAULT 'NEEDS-ACTION' NOT NULL,
	"href" text NOT NULL,
	"etag" text,
	"notified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_instance_idx" ON "calendar_events" USING btree ("user_id","uid","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_events_user_start_idx" ON "calendar_events" USING btree ("user_id","starts_at");