-- Card limits per person, a block switch, and our own card fee.
ALTER TABLE "card_accounts" ADD COLUMN "limits" JSONB;
ALTER TABLE "card_accounts" ADD COLUMN "blocked_at" TIMESTAMP(3);
ALTER TABLE "card_accounts" ADD COLUMN "blocked_by" TEXT;
ALTER TABLE "cards" ADD COLUMN "fee_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cards" ADD COLUMN "fee_transfer_id" TEXT;
ALTER TABLE "cards" ADD COLUMN "admin_action" TEXT;
