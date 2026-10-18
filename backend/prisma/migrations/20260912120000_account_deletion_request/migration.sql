-- Account closure is requested, then actioned by an admin.
ALTER TABLE "users" ADD COLUMN "deletion_requested_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "deletion_reason" TEXT;
