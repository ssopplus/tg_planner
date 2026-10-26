CREATE TABLE "reading_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"en" text NOT NULL,
	"ru" text NOT NULL,
	"ctx" text DEFAULT '' NOT NULL,
	"forms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"box" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"lang" text NOT NULL,
	"day" date NOT NULL,
	"wpm" integer,
	"comp" integer,
	"ms" integer,
	"text_id" text,
	"title" text,
	"cards_reviewed" integer,
	"words_saved" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading_texts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"lang" text NOT NULL,
	"level" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"word_count" integer NOT NULL,
	"source" text DEFAULT 'paste' NOT NULL,
	"source_url" text,
	"glossary" jsonb,
	"questions" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reading_cards" ADD CONSTRAINT "reading_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_texts" ADD CONSTRAINT "reading_texts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reading_cards_user_en_idx" ON "reading_cards" USING btree ("user_id","en");--> statement-breakpoint
CREATE INDEX "reading_cards_user_due_idx" ON "reading_cards" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "reading_sessions_user_day_idx" ON "reading_sessions" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "reading_sessions_user_type_idx" ON "reading_sessions" USING btree ("user_id","type","lang");--> statement-breakpoint
CREATE INDEX "reading_texts_user_lang_idx" ON "reading_texts" USING btree ("user_id","lang");--> statement-breakpoint
CREATE UNIQUE INDEX "reading_texts_user_source_url_idx" ON "reading_texts" USING btree ("user_id","source_url") WHERE "reading_texts"."source_url" is not null;