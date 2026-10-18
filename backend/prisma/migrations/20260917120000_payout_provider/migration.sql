-- A switch that chooses rather than toggles.
ALTER TABLE "service_status" ADD COLUMN "value" TEXT;

-- A recipient id belongs to the provider that minted it. Twenty of the forty
-- banks share a code between Flutterwave and Paystack, so the old global key
-- would have handed one provider the other's recipient.
DROP INDEX IF EXISTS "payout_recipients_account_key_key";
CREATE UNIQUE INDEX "payout_recipients_provider_account_key_key"
  ON "payout_recipients" ("provider", "account_key");
