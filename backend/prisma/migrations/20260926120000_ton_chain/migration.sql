-- TON: The Open Network. USDT only; USDC is not issued there.
--
-- Additive, and safe to run before the code that uses it: nothing writes TON
-- until the chain is offered in the app. Note that Postgres will not let an
-- enum value be dropped again, so this is one-way.
ALTER TYPE "Chain" ADD VALUE 'TON';
