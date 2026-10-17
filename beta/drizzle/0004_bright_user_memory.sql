ALTER TABLE "users" ADD COLUMN "about_me" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_facts" jsonb DEFAULT '[]' NOT NULL;