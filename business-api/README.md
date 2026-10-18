# Money Moves Business API

The merchant side of Money Moves: its own service and **its own database**. Nothing here reads the Money Moves app's tables or uses its keys. Where the two meet (a linked Money Moves account, an app payment to a business), they talk through a narrow internal API.

## Run it locally

```bash
cp .env.example .env        # git ignores .env - fill it in
npm install
npx prisma migrate dev      # creates the tables in YOUR local business database
npm run dev                 # http://localhost:4100
```

Use a fresh local Postgres. **Never point `DATABASE_URL` at the app's database.**

In development, emails (sign-in codes) are printed to the console when `RESEND_API_KEY` is empty. Staging and production refuse to start without it.

## What's here

- **Sign-in:** email + password with a 6-digit code (2-step, always on), or Google. Business users are not app users, and Dynamic plays no part in signing in. Dynamic only creates the business wallet once a business is activated, and signs from it.
- **Sessions:** a random token in an `httpOnly`, `SameSite=Lax` cookie, with only its SHA-256 kept in the database. Every state-changing request must come from an allowed origin.
- **Codes:** stored as an HMAC keyed with `CODE_PEPPER`. They last 10 minutes and allow 5 tries, and each one works once.
- **Unknown emails:** sign-in says plainly when an email has no account (the per-address rate limit stops bulk checking). Sign-up and "forgot password" still answer the same either way.
- **Audit log:** every sign-in and every change that matters.
- **Businesses:** owner and team roles, and the **settlement chain**. Crypto always settles as USDC on the chain the business picks (Movement, Arc or Monad), whatever the customer paid with.

## Money

- **Payout places:** up to five bank accounts per business. Each is looked up with the bank when it's added, and the bank's name for it must match the business (or, for "Just me", the person). Only a matching account can be settled to.
- **Payment links:** a test or live link at an address that never changes. Customers pay by bank transfer into a one-time account for the exact amount, open for 30 minutes. The Money Moves app and crypto come next.
- **Settlement:** the moment a transfer is confirmed, the fee comes off (0.5%, at most ₦1,000) and one payout per payment goes to the business's bank. It is never batched. A payout that fails is **never resent by itself**: ops checks with the rail first. The business sees it as on its way, never as failed.
- **The worker** (`src/worker`) asks the rail about open payments every few seconds and follows payouts until the bank confirms. Every step that moves money claims its row first, so running two workers can't pay twice.
- **Test mode and the simulator:** test-mode links, payments and settlements run on the simulator (`src/rails/simulator.ts`) in every environment, and never touch a real account. The test checkout has buttons to pretend the transfer arrived, in full or short, and to make the settlement fail.
- **Live mode** follows `NAIRA_RAILS`: `simulated` on staging and in development, `off` in production until Flutterwave is connected (`simulated` is refused there at start-up).
- **Simulator account numbers:** ending `0000` don't exist; ending `9999` belong to someone else, so the name won't match.

## Rules that don't bend

- Secrets live in Railway variables (or your local `.env`), never in git. Only `.env.example` is committed.
- Logs hide anything that looks like a password, code, token, key or cookie.
- Money never moves because of a number in this database. It moves only on proof: a confirmed on-chain transfer, or a Flutterwave payment checked with Flutterwave's API.
