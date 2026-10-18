-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "login_verified_at" TIMESTAMP(3);

-- Backfill: treat all pre-existing sessions as already-verified so active
-- users are not bounced to the verify-email screen on deploy.
UPDATE "sessions" SET "login_verified_at" = "created_at" WHERE "login_verified_at" IS NULL;
