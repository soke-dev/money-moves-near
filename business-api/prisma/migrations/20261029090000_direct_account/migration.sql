-- CreateEnum
CREATE TYPE "DirectDepositStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ApiKeyKind" AS ENUM ('STANDARD', 'DIRECT');

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "direct_allowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "direct_allowed_at" TIMESTAMP(3),
ADD COLUMN     "direct_allowed_by" TEXT,
ADD COLUMN     "direct_daily_ngn" INTEGER,
ADD COLUMN     "direct_max_ngn" INTEGER,
ADD COLUMN     "direct_min_ngn" INTEGER,
ADD COLUMN     "psa_account_bank" TEXT,
ADD COLUMN     "psa_account_name" TEXT,
ADD COLUMN     "psa_account_number" TEXT,
ADD COLUMN     "psa_barter_id" TEXT,
ADD COLUMN     "psa_checked_at" TIMESTAMP(3),
ADD COLUMN     "psa_reference" TEXT;

-- AlterTable
ALTER TABLE "payment_links" ADD COLUMN     "direct" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "direct" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "direct_settle_note" TEXT,
ADD COLUMN     "direct_settled_at" TIMESTAMP(3),
ADD COLUMN     "direct_settled_by" TEXT;

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "kind" "ApiKeyKind" NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "direct_deposits" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "fee_kobo" INTEGER,
    "sender_name" TEXT,
    "sender_account" TEXT,
    "sender_bank" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "status" "DirectDepositStatus" NOT NULL DEFAULT 'UNMATCHED',
    "payment_id" TEXT,
    "note" TEXT,
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "direct_deposits_reference_key" ON "direct_deposits"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "direct_deposits_payment_id_key" ON "direct_deposits"("payment_id");

-- CreateIndex
CREATE INDEX "direct_deposits_business_id_status_idx" ON "direct_deposits"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_psa_reference_key" ON "businesses"("psa_reference");

-- AddForeignKey
ALTER TABLE "direct_deposits" ADD CONSTRAINT "direct_deposits_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_deposits" ADD CONSTRAINT "direct_deposits_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

