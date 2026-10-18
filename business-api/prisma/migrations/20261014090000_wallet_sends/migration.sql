-- Money leaving a business wallet: prepared by us, signed by the owner, checked and broadcast.
CREATE TYPE "WalletSendKind" AS ENUM ('ADDRESS', 'BANK');
CREATE TYPE "WalletSendStatus" AS ENUM ('PREPARED', 'SENT', 'CONFIRMED', 'PAYING', 'PAID', 'FAILED', 'EXPIRED');

CREATE TABLE "wallet_sends" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "kind" "WalletSendKind" NOT NULL,
    "status" "WalletSendStatus" NOT NULL DEFAULT 'PREPARED',
    "chain" "SettleChain" NOT NULL,
    "to_address" TEXT NOT NULL,
    "amount_micros" BIGINT NOT NULL,
    "bank_account_id" TEXT,
    "bank_code" TEXT,
    "bank_name" TEXT,
    "account_number" TEXT,
    "account_name" TEXT,
    "ngn_per_usd" DOUBLE PRECISION,
    "fee_kobo" INTEGER,
    "payout_kobo" INTEGER,
    "unsigned_tx" JSONB NOT NULL,
    "tx_hash" TEXT,
    "failure_reason" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_sends_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_sends_ref_key" ON "wallet_sends"("ref");
CREATE INDEX "wallet_sends_business_id_created_at_idx" ON "wallet_sends"("business_id", "created_at");
CREATE INDEX "wallet_sends_status_idx" ON "wallet_sends"("status");

ALTER TABLE "wallet_sends" ADD CONSTRAINT "wallet_sends_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "business_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
