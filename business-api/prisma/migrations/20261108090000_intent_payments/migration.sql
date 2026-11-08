-- Paying with another coin through NEAR Intents.
ALTER TABLE "payments" ADD COLUMN "intent" JSONB;
