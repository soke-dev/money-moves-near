-- Checkouts on Money Moves Business paid from the app, approved by the person who pays.
CREATE TABLE "business_payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "code" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "payment_ref" TEXT NOT NULL,
    "title" TEXT,
    "amount" DECIMAL(20,6) NOT NULL,
    "price_label" TEXT,
    "addresses" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "transaction_id" TEXT,
    "paid_chain" TEXT,
    "paid_asset" TEXT,
    "tx_hash" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    CONSTRAINT "business_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_payments_code_key" ON "business_payments"("code");
CREATE UNIQUE INDEX "business_payments_payment_ref_key" ON "business_payments"("payment_ref");
CREATE INDEX "business_payments_user_id_status_idx" ON "business_payments"("user_id", "status");

ALTER TABLE "business_payments" ADD CONSTRAINT "business_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
