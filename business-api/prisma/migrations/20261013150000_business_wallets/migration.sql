-- The business wallet: the owner's own, with a transfer PIN kept as a hash.
ALTER TYPE "CodePurpose" ADD VALUE 'RESET_WALLET_PIN';

CREATE TABLE "business_wallets" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "dynamic_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "evm_address" TEXT,
    "solana_address" TEXT,
    "movement_address" TEXT,
    "pin_hash" TEXT,
    "pin_set_at" TIMESTAMP(3),
    "pin_failures" INTEGER NOT NULL DEFAULT 0,
    "pin_locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_wallets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_wallets_business_id_key" ON "business_wallets"("business_id");

ALTER TABLE "business_wallets" ADD CONSTRAINT "business_wallets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
