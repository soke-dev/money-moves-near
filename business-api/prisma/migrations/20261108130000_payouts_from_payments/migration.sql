-- Crypto payouts paid out of their own payment's money: where each arrival was swept, how, and when it reached the float.
ALTER TABLE "crypto_arrivals" ADD COLUMN "swept_to" TEXT;
ALTER TABLE "crypto_arrivals" ADD COLUMN "sweep_via" TEXT;
ALTER TABLE "crypto_arrivals" ADD COLUMN "funded_at" TIMESTAMP(3);
ALTER TABLE "crypto_arrivals" ADD COLUMN "fund_error" TEXT;
