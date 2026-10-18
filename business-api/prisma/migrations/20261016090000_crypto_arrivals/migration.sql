-- CreateEnum
CREATE TYPE "DepositKind" AS ENUM ('OWN', 'MEMO', 'AMOUNT');

-- AlterEnum
ALTER TYPE "SettleChain" ADD VALUE 'STELLAR';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "deposit_kind" "DepositKind",
ADD COLUMN     "deposit_memo" TEXT,
ADD COLUMN     "looked_at" TIMESTAMP(3),
ADD COLUMN     "received_micros" BIGINT;

-- CreateTable
CREATE TABLE "crypto_arrivals" (
    "id" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "payment_id" TEXT,
    "network" TEXT NOT NULL,
    "coin" TEXT NOT NULL,
    "token" TEXT,
    "micros" BIGINT NOT NULL,
    "from_address" TEXT,
    "to_address" TEXT NOT NULL,
    "memo" TEXT,
    "tx_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "used_micros" BIGINT NOT NULL DEFAULT 0,
    "swept_at" TIMESTAMP(3),
    "sweep_tx" TEXT,
    "sweeping_at" TIMESTAMP(3),
    "return_micros" BIGINT,
    "return_status" TEXT,
    "return_why" TEXT,
    "return_to" TEXT,
    "return_memo" TEXT,
    "return_token" TEXT,
    "return_tx" TEXT,
    "return_error" TEXT,
    "return_asked_at" TIMESTAMP(3),
    "return_sent_at" TIMESTAMP(3),
    "return_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crypto_arrivals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crypto_arrivals_session_key" ON "crypto_arrivals"("session");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_arrivals_return_token_key" ON "crypto_arrivals"("return_token");

-- CreateIndex
CREATE INDEX "crypto_arrivals_payment_id_idx" ON "crypto_arrivals"("payment_id");

-- CreateIndex
CREATE INDEX "crypto_arrivals_to_address_idx" ON "crypto_arrivals"("to_address");

-- CreateIndex
CREATE INDEX "crypto_arrivals_return_status_idx" ON "crypto_arrivals"("return_status");

-- CreateIndex
CREATE INDEX "crypto_arrivals_kind_created_at_idx" ON "crypto_arrivals"("kind", "created_at");

-- CreateIndex
CREATE INDEX "payments_deposit_address_idx" ON "payments"("deposit_address");

-- CreateIndex
CREATE INDEX "payments_deposit_memo_idx" ON "payments"("deposit_memo");

-- AddForeignKey
ALTER TABLE "crypto_arrivals" ADD CONSTRAINT "crypto_arrivals_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

