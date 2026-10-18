-- A deposit started but not yet paid. The virtual-account webhook cannot be
-- attributed to a user on its own, so this row records who is buying what, and
-- at which rate, before the account number is shown.
CREATE TABLE "funding_intents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'flutterwave',
    "amount_naira" DECIMAL(20,2) NOT NULL,
    "token" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "converted_amount" DECIMAL(20,8) NOT NULL,
    "rate" DECIMAL(20,8),
    "customer_id" TEXT,
    "account_number" TEXT,
    "bank_name" TEXT,
    "expires_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "charge_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_intents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "funding_intents_reference_key" ON "funding_intents"("reference");
CREATE INDEX "funding_intents_user_id_idx" ON "funding_intents"("user_id");
CREATE INDEX "funding_intents_status_idx" ON "funding_intents"("status");

ALTER TABLE "funding_intents" ADD CONSTRAINT "funding_intents_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
