-- A card asked for together with a top up, made once the money lands.
ALTER TABLE "card_accounts" ADD COLUMN "pending_card" JSONB;
ALTER TABLE "card_accounts" ADD COLUMN "pending_card_at" TIMESTAMP(3);
ALTER TABLE "card_accounts" ADD COLUMN "pending_card_error" TEXT;
