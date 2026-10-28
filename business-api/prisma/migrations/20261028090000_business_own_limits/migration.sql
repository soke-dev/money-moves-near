-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "own_checkout" JSONB,
ADD COLUMN     "review_crypto_above_usd" DOUBLE PRECISION,
ADD COLUMN     "review_naira_above_ngn" INTEGER;
