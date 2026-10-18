-- Vouchers: a reward somebody claims with a code, and the record of each claim.
--
-- Additive only. Two new tables and three new enums; nothing existing is
-- altered, so this can be applied to a live database without a window.

CREATE TYPE "VoucherKind" AS ENUM ('PUBLIC', 'UNIQUE');
CREATE TYPE "VoucherStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');
CREATE TYPE "VoucherClaimStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "vouchers" (
    "id"              TEXT NOT NULL,
    "code"            TEXT NOT NULL,
    "kind"            "VoucherKind" NOT NULL DEFAULT 'PUBLIC',
    "rewardAsset"     "Asset" NOT NULL DEFAULT 'USDCx',
    "reward_amount"   DECIMAL(20,8) NOT NULL,
    "total_claims"    INTEGER,
    "per_user_claims" INTEGER NOT NULL DEFAULT 1,
    "requirements"    JSONB NOT NULL DEFAULT '[]',
    "status"          "VoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "starts_at"       TIMESTAMP(3),
    "ends_at"         TIMESTAMP(3),
    "note"            TEXT,
    "created_by"      TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- The lookup every claim starts with, and the guarantee that two vouchers
-- cannot share a code. Codes are stored and compared upper-cased.
CREATE UNIQUE INDEX "vouchers_code_key" ON "vouchers"("code");
CREATE INDEX "vouchers_status_idx" ON "vouchers"("status");

CREATE TABLE "voucher_claims" (
    "id"         TEXT NOT NULL,
    "voucher_id" TEXT NOT NULL,
    "user_id"    TEXT NOT NULL,
    "amount"     DECIMAL(20,8) NOT NULL,
    "status"     "VoucherClaimStatus" NOT NULL DEFAULT 'PENDING',
    "tx_hash"    TEXT,
    "error"      TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voucher_claims_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "voucher_claims_voucher_id_created_at_idx"
  ON "voucher_claims"("voucher_id", "created_at");
CREATE INDEX "voucher_claims_user_id_created_at_idx"
  ON "voucher_claims"("user_id", "created_at");

ALTER TABLE "voucher_claims"
  ADD CONSTRAINT "voucher_claims_voucher_id_fkey"
  FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "voucher_claims"
  ADD CONSTRAINT "voucher_claims_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
