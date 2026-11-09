-- Bachs never pays out.
UPDATE "businesses" SET "payout_rail" = NULL WHERE "payout_rail" IS NOT NULL;
