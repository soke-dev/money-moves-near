-- AlterTable
ALTER TABLE "identity_checks" ADD COLUMN     "handoff_expires_at" TIMESTAMP(3),
ADD COLUMN     "handoff_hash" TEXT,
ADD COLUMN     "handoff_opened_at" TIMESTAMP(3),
ADD COLUMN     "id_type" TEXT,
ADD COLUMN     "redo" JSONB,
ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by" TEXT,
ADD COLUMN     "submitted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "identity_files" (
    "id" TEXT NOT NULL,
    "check_id" TEXT NOT NULL,
    "part" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replaced_at" TIMESTAMP(3),

    CONSTRAINT "identity_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "identity_files_check_id_part_idx" ON "identity_files"("check_id", "part");

-- CreateIndex
CREATE UNIQUE INDEX "identity_checks_handoff_hash_key" ON "identity_checks"("handoff_hash");

-- CreateIndex
CREATE INDEX "identity_checks_provider_status_idx" ON "identity_checks"("provider", "status");

-- AddForeignKey
ALTER TABLE "identity_files" ADD CONSTRAINT "identity_files_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "identity_checks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
