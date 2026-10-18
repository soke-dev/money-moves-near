-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by" TEXT;

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "admin_note" TEXT,
ADD COLUMN     "fee_cap_kobo" INTEGER,
ADD COLUMN     "fee_rate_bps" INTEGER,
ADD COLUMN     "status_changed_at" TIMESTAMP(3),
ADD COLUMN     "status_reason" TEXT;

-- CreateTable
CREATE TABLE "settlement_events" (
    "id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB,
    "by" TEXT NOT NULL DEFAULT 'system',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settlement_events_settlement_id_created_at_idx" ON "settlement_events"("settlement_id", "created_at");

-- AddForeignKey
ALTER TABLE "settlement_events" ADD CONSTRAINT "settlement_events_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
