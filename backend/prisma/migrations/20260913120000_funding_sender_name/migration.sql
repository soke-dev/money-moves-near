-- Who a naira deposit actually came from.
--
-- Recorded on every settled deposit, enforcing or not: whether the sender's
-- name can be trusted to identify the buyer is a question about real senders,
-- and it cannot be answered without first writing them down.
ALTER TABLE "funding_intents" ADD COLUMN "sender_name"  TEXT;
ALTER TABLE "funding_intents" ADD COLUMN "sender_bank"  TEXT;
ALTER TABLE "funding_intents" ADD COLUMN "name_verdict" TEXT;
ALTER TABLE "funding_intents" ADD COLUMN "hold_reason"  TEXT;
ALTER TABLE "funding_intents" ADD COLUMN "reviewed_at"  TIMESTAMP(3);
ALTER TABLE "funding_intents" ADD COLUMN "reviewed_by"  TEXT;
