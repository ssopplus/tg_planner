CREATE TABLE "cockpit_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"session_name" text NOT NULL,
	"project" text,
	"kind" text NOT NULL,
	"tool_name" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"can_always" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision" jsonb,
	"delivered_at" timestamp,
	"chat_id" text,
	"message_id" integer,
	"created_at" timestamp NOT NULL,
	"answered_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "cockpit_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"sessions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cockpit_requests" ADD CONSTRAINT "cockpit_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cockpit_state" ADD CONSTRAINT "cockpit_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cockpit_requests_user_status_idx" ON "cockpit_requests" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "cockpit_requests_created_idx" ON "cockpit_requests" USING btree ("created_at");