-- A lucky voucher: one pot cut into unequal slices, shuffled at creation so
-- the order they go out in carries no information about their size.
CREATE TYPE "VoucherMode" AS ENUM ('FIXED', 'LUCKY');

ALTER TABLE "vouchers" ADD COLUMN "mode" "VoucherMode" NOT NULL DEFAULT 'FIXED';
ALTER TABLE "vouchers" ADD COLUMN "pot_amount" DECIMAL(20,8);

CREATE TABLE "voucher_slices" (
    "id" TEXT NOT NULL,
    "voucher_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "claim_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "voucher_slices_pkey" PRIMARY KEY ("id")
);

-- One slice can never pay twice.
CREATE UNIQUE INDEX "voucher_slices_claim_id_key" ON "voucher_slices"("claim_id");
CREATE UNIQUE INDEX "voucher_slices_voucher_id_position_key" ON "voucher_slices"("voucher_id", "position");
-- Finding the next unclaimed slice, which every claim does.
CREATE INDEX "voucher_slices_voucher_id_claim_id_idx" ON "voucher_slices"("voucher_id", "claim_id");

ALTER TABLE "voucher_slices" ADD CONSTRAINT "voucher_slices_voucher_id_fkey"
    FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voucher_slices" ADD CONSTRAINT "voucher_slices_claim_id_fkey"
    FOREIGN KEY ("claim_id") REFERENCES "voucher_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;
