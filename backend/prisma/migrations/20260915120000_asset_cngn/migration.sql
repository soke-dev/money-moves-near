-- cNGN, a naira stablecoin on Base and BNB Smart Chain.
--
-- Postgres will not add a value to an enum inside a transaction that then
-- uses it, which is why this is its own migration and nothing here reads it.
ALTER TYPE "Asset" ADD VALUE IF NOT EXISTS 'cNGN';
