-- Stellar: USDC and USDT0 on the Solana key, opened per coin on first use.
--
-- Additive, and safe to run before the code that uses it: nothing writes
-- STELLAR until a user turns it on in the app. Postgres will not let an enum
-- value be dropped again, so this is one-way.
ALTER TYPE "Chain" ADD VALUE 'STELLAR';
