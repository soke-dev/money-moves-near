-- A sale whose crypto was returned to the customer.
--
-- FAILED says the transfer did not happen; it says nothing about whether
-- anyone got their money back. Somebody reading the ledger a month later
-- cannot tell a refunded sale from an abandoned one, and that is exactly
-- the question a support conversation opens with.
--
-- Postgres will not add a value to an enum inside a transaction that then
-- uses it, which is why this is its own migration and nothing here reads it.
ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';
