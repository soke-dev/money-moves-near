-- Monthly card fee (when it was last taken) and auto freeze after repeated declines.
ALTER TABLE "cards" ADD COLUMN "monthly_fee_at" TIMESTAMP(3);
ALTER TABLE "cards" ADD COLUMN "auto_frozen_at" TIMESTAMP(3);
