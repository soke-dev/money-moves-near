-- A new card's creation fee, kept back from the top up that pays for it.
ALTER TABLE "card_topups" ADD COLUMN "card_fee_cents" INTEGER NOT NULL DEFAULT 0;
