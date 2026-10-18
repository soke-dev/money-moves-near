-- A handset identifier on each session, so account creation can be counted per
-- device. Nullable: every build from before this shipped sends nothing, and a
-- session without one must keep working.
ALTER TABLE "sessions" ADD COLUMN "device_id" TEXT;

-- The count runs on every registration, so it reads an index rather than the
-- table.
CREATE INDEX "sessions_device_id_idx" ON "sessions"("device_id");

-- Devices waved through the limit. Somebody legitimate will be caught by it,
-- and support needs to let them past without a deploy.
CREATE TABLE "device_exceptions" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_exceptions_device_id_key" ON "device_exceptions"("device_id");
