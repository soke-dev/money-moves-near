-- Solana as a settlement chain.
ALTER TYPE "SettleChain" ADD VALUE IF NOT EXISTS 'SOLANA';

-- The coins and networks each checkout takes from a crypto wallet. Null: every one that's switched on.
ALTER TABLE "payment_links" ADD COLUMN "accept" JSONB;
ALTER TABLE "invoices" ADD COLUMN "accept" JSONB;
ALTER TABLE "outlets" ADD COLUMN "accept" JSONB;

-- A test crypto payment: the coin, the network, and the address shown for it.
ALTER TABLE "payments" ADD COLUMN "coin" TEXT;
ALTER TABLE "payments" ADD COLUMN "network" TEXT;
ALTER TABLE "payments" ADD COLUMN "deposit_address" TEXT;
