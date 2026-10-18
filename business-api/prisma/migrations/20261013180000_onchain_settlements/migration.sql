-- On-chain settlements: the chain, the address, the amount in USDC and the transaction.
ALTER TABLE "settlements" ADD COLUMN "chain" "SettleChain";
ALTER TABLE "settlements" ADD COLUMN "to_address" TEXT;
ALTER TABLE "settlements" ADD COLUMN "amount_micros" BIGINT;
ALTER TABLE "settlements" ADD COLUMN "tx_hash" TEXT;
