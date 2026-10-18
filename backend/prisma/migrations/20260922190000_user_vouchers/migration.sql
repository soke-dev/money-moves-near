-- Vouchers people make with their own money. Funded into a separate escrow
-- wallet, and whatever nobody claims goes back to whoever put it in.
CREATE TYPE "RefundState" AS ENUM ('NONE', 'DUE', 'SENT', 'FAILED');

ALTER TABLE "vouchers" ADD COLUMN "created_by_user_id" TEXT;
ALTER TABLE "vouchers" ADD COLUMN "funding_tx_hash" TEXT;
ALTER TABLE "vouchers" ADD COLUMN "refund_state" "RefundState" NOT NULL DEFAULT 'NONE';
ALTER TABLE "vouchers" ADD COLUMN "refund_amount" DECIMAL(20,8);
ALTER TABLE "vouchers" ADD COLUMN "refund_tx_hash" TEXT;
ALTER TABLE "vouchers" ADD COLUMN "refund_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "vouchers" ADD COLUMN "refund_error" TEXT;
ALTER TABLE "vouchers" ADD COLUMN "refunded_at" TIMESTAMP(3);

CREATE INDEX "vouchers_created_by_user_id_created_at_idx" ON "vouchers"("created_by_user_id", "created_at");
-- The refund sweep's only query.
CREATE INDEX "vouchers_refund_state_idx" ON "vouchers"("refund_state");

ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
