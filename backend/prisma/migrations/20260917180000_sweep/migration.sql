-- Postgres enum values cannot be added inside a transaction that also uses
-- them, so this migration does nothing else.
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'SWEEP';
