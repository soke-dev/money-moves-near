-- CreateEnum
CREATE TYPE "InvoiceRepeat" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- AlterEnum
ALTER TYPE "CodePurpose" ADD VALUE 'SIGN_IN_APP';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "recovery_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "totp_last_step" INTEGER,
ADD COLUMN     "totp_pending" TEXT,
ADD COLUMN     "totp_secret" TEXT;

-- AlterTable
ALTER TABLE "login_codes" ADD COLUMN     "via" TEXT;

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "api_bank_account_id" TEXT,
ADD COLUMN     "api_settle_to" "Destination",
ADD COLUMN     "daily_limit_ngn" INTEGER,
ADD COLUMN     "methods_off" "PayMethod"[] DEFAULT ARRAY[]::"PayMethod"[],
ADD COLUMN     "require_app_two_step" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "next_issue_at" TIMESTAMP(3),
ADD COLUMN     "repeat_every" "InvoiceRepeat",
ADD COLUMN     "repeat_of_id" TEXT,
ADD COLUMN     "repeat_until" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "invoices_next_issue_at_idx" ON "invoices"("next_issue_at");

-- CreateIndex
CREATE INDEX "invoices_repeat_of_id_idx" ON "invoices"("repeat_of_id");

