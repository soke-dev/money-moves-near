-- Flutterwave recipient ids, keyed by bank account.
-- Creating a recipient is not idempotent (409 on repeat) and the list endpoint
-- cannot be searched by account number, so we remember the id ourselves.
CREATE TABLE "payout_recipients" (
    "id" TEXT NOT NULL,
    "account_key" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'flutterwave',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_recipients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payout_recipients_account_key_key" ON "payout_recipients"("account_key");
