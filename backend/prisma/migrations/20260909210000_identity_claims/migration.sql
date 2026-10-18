-- One row per real-world identifier proven by a completed KYC check.
-- The UNIQUE index on "key" is what makes "one ID cannot verify two accounts"
-- a guarantee rather than a race-prone application check.
CREATE TABLE "identity_claims" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "identity_claims_key_key" ON "identity_claims"("key");

CREATE INDEX "identity_claims_user_id_idx" ON "identity_claims"("user_id");

ALTER TABLE "identity_claims" ADD CONSTRAINT "identity_claims_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
