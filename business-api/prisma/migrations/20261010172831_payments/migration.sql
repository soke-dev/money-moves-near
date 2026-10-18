-- CreateEnum
CREATE TYPE "Mode" AS ENUM ('TEST', 'LIVE');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('NGN', 'USD');

-- CreateEnum
CREATE TYPE "PayMethod" AS ENUM ('APP', 'CRYPTO', 'NAIRA');

-- CreateEnum
CREATE TYPE "Destination" AS ENUM ('BANK', 'MONEY_MOVES', 'WALLET');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('OPEN', 'PAID', 'UNDERPAID', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'SETTLED', 'FAILED', 'HELD');

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "name_matches" BOOLEAN NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_links" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency" "Currency" NOT NULL,
    "amount_minor" INTEGER,
    "min_minor" INTEGER,
    "methods" "PayMethod"[],
    "destination" "Destination" NOT NULL,
    "bank_account_id" TEXT,
    "redirect_url" TEXT,
    "ask_phone" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "link_id" TEXT,
    "mode" "Mode" NOT NULL,
    "method" "PayMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'OPEN',
    "currency" "Currency" NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "ngn_per_usd" DOUBLE PRECISION NOT NULL,
    "customer_email" TEXT,
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "account_bank" TEXT,
    "account_number" TEXT,
    "account_name" TEXT,
    "provider_ref" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "received_kobo" INTEGER,
    "payer_name" TEXT,
    "payer_bank" TEXT,
    "payer_account" TEXT,
    "payer_session" TEXT,
    "paid_at" TIMESTAMP(3),
    "fee_kobo" INTEGER,
    "sim_fail_settlement" BOOLEAN NOT NULL DEFAULT false,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "mode" "Mode" NOT NULL,
    "destination" "Destination" NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'QUEUED',
    "bank_account_id" TEXT,
    "bank_code" TEXT,
    "bank_name" TEXT,
    "account_number" TEXT,
    "account_name" TEXT,
    "amount_kobo" INTEGER NOT NULL,
    "fee_kobo" INTEGER NOT NULL,
    "provider_ref" TEXT,
    "failure_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_inbound" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "payer_name" TEXT NOT NULL,
    "payer_bank" TEXT NOT NULL,
    "payer_account" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_inbound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_transfers" (
    "ref" TEXT NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "bank_code" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "fail" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_transfers_pkey" PRIMARY KEY ("ref")
);

-- CreateIndex
CREATE INDEX "bank_accounts_business_id_idx" ON "bank_accounts"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_slug_key" ON "payment_links"("slug");

-- CreateIndex
CREATE INDEX "payment_links_business_id_mode_idx" ON "payment_links"("business_id", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "payments_ref_key" ON "payments"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "payments_token_key" ON "payments"("token");

-- CreateIndex
CREATE INDEX "payments_business_id_mode_created_at_idx" ON "payments"("business_id", "mode", "created_at");

-- CreateIndex
CREATE INDEX "payments_status_expires_at_idx" ON "payments"("status", "expires_at");

-- CreateIndex
CREATE INDEX "payments_link_id_idx" ON "payments"("link_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_ref_key" ON "settlements"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_payment_id_key" ON "settlements"("payment_id");

-- CreateIndex
CREATE INDEX "settlements_status_idx" ON "settlements"("status");

-- CreateIndex
CREATE INDEX "settlements_business_id_mode_created_at_idx" ON "settlements"("business_id", "mode", "created_at");

-- CreateIndex
CREATE INDEX "sim_inbound_ref_idx" ON "sim_inbound"("ref");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "payment_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
