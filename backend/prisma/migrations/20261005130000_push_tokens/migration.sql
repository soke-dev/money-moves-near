-- One push token per phone, rather than one per account. Additive only:
-- nothing existing is altered, and notification_prefs.expo_push_token stays.
CREATE TABLE "push_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "session_id" TEXT,
    "platform" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");
CREATE INDEX "push_tokens_user_id_idx" ON "push_tokens"("user_id");

ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
