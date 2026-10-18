-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('AWAITING_FUNDS', 'SENDING', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundFunding" AS ENUM ('WALLET', 'APP', 'BANK', 'HELD');

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'AWAITING_FUNDS',
    "funding" "RefundFunding" NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "fee_back_kobo" INTEGER NOT NULL,
    "fund_kobo" INTEGER NOT NULL,
    "fund_cents" INTEGER NOT NULL,
    "fund_bank" TEXT,
    "fund_account" TEXT,
    "fund_name" TEXT,
    "fund_provider_ref" TEXT,
    "fund_expires_at" TIMESTAMP(3),
    "funded_at" TIMESTAMP(3),
    "to_kind" TEXT NOT NULL,
    "to_name" TEXT,
    "to_bank" TEXT,
    "to_account" TEXT,
    "to_coin" TEXT,
    "to_network" TEXT,
    "reason" TEXT,
    "requested_by" TEXT NOT NULL,
    "sent_by" TEXT,
    "send_note" TEXT,
    "done_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_events" (
    "id" TEXT NOT NULL,
    "refund_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB,
    "by" TEXT NOT NULL DEFAULT 'system',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refunds_ref_key" ON "refunds"("ref");

-- CreateIndex
CREATE INDEX "refunds_business_id_mode_created_at_idx" ON "refunds"("business_id", "mode", "created_at");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "refunds"("status");

-- CreateIndex
CREATE INDEX "refund_events_refund_id_created_at_idx" ON "refund_events"("refund_id", "created_at");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_events" ADD CONSTRAINT "refund_events_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Like every record a business has: never deleted. A refund's timeline is written once.
CREATE TRIGGER keep_rows BEFORE DELETE ON "refunds" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "refunds" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_rows BEFORE DELETE ON "refund_events" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "refund_events" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
