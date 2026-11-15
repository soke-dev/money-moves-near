-- Card balance moved back to the wallet.
CREATE TYPE "CardWithdrawalStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
CREATE TABLE "card_withdrawals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "fee_cents" INTEGER NOT NULL DEFAULT 0,
    "address" TEXT NOT NULL,
    "status" "CardWithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "nuvion_transfer_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "card_withdrawals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "card_withdrawals_nuvion_transfer_id_key" ON "card_withdrawals"("nuvion_transfer_id");
CREATE INDEX "card_withdrawals_user_id_idx" ON "card_withdrawals"("user_id");
CREATE INDEX "card_withdrawals_status_idx" ON "card_withdrawals"("status");
ALTER TABLE "card_accounts" ADD COLUMN "wallet_address" TEXT;
ALTER TABLE "card_accounts" ADD COLUMN "wallet_detail_id" TEXT;
-- Each card its own account; which card a top up is for.
ALTER TABLE "cards" ADD COLUMN "nuvion_account_id" TEXT;
ALTER TABLE "cards" ADD COLUMN "payment_detail_id" TEXT;
ALTER TABLE "card_topups" ADD COLUMN "target" TEXT;
ALTER TABLE "card_accounts" ADD COLUMN "topup_target" TEXT;
ALTER TABLE "card_accounts" ADD COLUMN "topup_target_at" TIMESTAMP(3);
ALTER TABLE "card_withdrawals" ADD COLUMN "card_id" TEXT;
