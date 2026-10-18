-- A refund funded from the Money Moves app or the business wallet: the app's request code, the transaction that paid it, and the wallet send behind it.
ALTER TABLE "refunds" ADD COLUMN "fund_code" TEXT;
ALTER TABLE "refunds" ADD COLUMN "fund_tx" TEXT;
CREATE UNIQUE INDEX "refunds_fund_tx_key" ON "refunds"("fund_tx");
ALTER TABLE "wallet_sends" ADD COLUMN "refund_id" TEXT;
CREATE INDEX "wallet_sends_refund_id_idx" ON "wallet_sends"("refund_id");
