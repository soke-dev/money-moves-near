-- Bachs as a second naira rail.
ALTER TABLE "businesses" ADD COLUMN "naira_collect" TEXT;
ALTER TABLE "businesses" ADD COLUMN "payout_rail" TEXT;
ALTER TABLE "payments" ADD COLUMN "bank_page" TEXT;
ALTER TABLE "settlements" ADD COLUMN "rail" TEXT;
