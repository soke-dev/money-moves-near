-- One wallet per business: an address may belong to only one business wallet.
--
-- Created only when no two existing wallets already share an address, so this
-- can never fail a deploy. If some do, the index is skipped with a notice and
-- the app's own check still refuses any new sharing; the shared ones need a
-- person, and the index can be added once they are sorted.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "business_wallets" WHERE "evm_address" IS NOT NULL GROUP BY "evm_address" HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "business_wallets_evm_address_key" ON "business_wallets"("evm_address");
  ELSE
    RAISE NOTICE 'business_wallets: shared evm_address found, unique index skipped';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "business_wallets" WHERE "solana_address" IS NOT NULL GROUP BY "solana_address" HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "business_wallets_solana_address_key" ON "business_wallets"("solana_address");
  ELSE
    RAISE NOTICE 'business_wallets: shared solana_address found, unique index skipped';
  END IF;
END $$;
