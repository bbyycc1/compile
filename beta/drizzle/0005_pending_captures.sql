CREATE TABLE "pending_captures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "text" text NOT NULL,
  "recent_turns" jsonb DEFAULT '[]' NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "result" jsonb,
  "error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
