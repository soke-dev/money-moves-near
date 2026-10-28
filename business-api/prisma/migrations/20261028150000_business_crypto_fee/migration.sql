-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "crypto_cap_cents" INTEGER,
ADD COLUMN     "crypto_rate_bps" INTEGER,
ADD COLUMN     "fee_payer_crypto" "FeePayer" NOT NULL DEFAULT 'BUSINESS';


-- One switch covered both ways to pay until now: keep each business on what it already chose,
-- so splitting them changes nothing for anyone.
UPDATE "businesses" SET "fee_payer_crypto" = "fee_payer";
