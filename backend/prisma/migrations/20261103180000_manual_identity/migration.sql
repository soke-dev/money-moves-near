-- AlterTable
ALTER TABLE "kyc_verifications" ADD COLUMN     "handoff_expires_at" TIMESTAMP(3),
ADD COLUMN     "handoff_hash" TEXT,
ADD COLUMN     "handoff_opened_at" TIMESTAMP(3),
ADD COLUMN     "redo" JSONB,
ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by" TEXT,
ADD COLUMN     "submitted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "kyc_files" (
    "id" TEXT NOT NULL,
    "verification_id" TEXT NOT NULL,
    "part" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replaced_at" TIMESTAMP(3),

    CONSTRAINT "kyc_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kyc_files_verification_id_part_idx" ON "kyc_files"("verification_id", "part");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_verifications_handoff_hash_key" ON "kyc_verifications"("handoff_hash");

-- CreateIndex
CREATE INDEX "kyc_verifications_provider_status_idx" ON "kyc_verifications"("provider", "status");

-- AddForeignKey
ALTER TABLE "kyc_files" ADD CONSTRAINT "kyc_files_verification_id_fkey" FOREIGN KEY ("verification_id") REFERENCES "kyc_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
