<div align="center">
  <img src="web/public/images/logo.png" alt="Money Moves" width="80" />
  <h1>Money Moves × NEAR Protocol</h1>
  <p><strong>Pay and get paid in almost any coin. Settle in seconds, in local fiat or stablecoins.</strong></p>
  <p>
    <a href="https://usemoneymoves.xyz">usemoneymoves.xyz</a> ·
    <a href="https://business.usemoneymoves.xyz">business.usemoneymoves.xyz</a> ·
    Live on the App Store and Google Play
  </p>
</div>

---

Money Moves is a self-custodial finance app for holding, spending and cashing out stablecoins, and **Money Moves Business** is a payments platform for businesses (checkout links, invoices, store QR codes, an API). Both are live with real users. This repository is our NEAR Hackathon submission (track: **Real-World Money**, with **Agent Economy** as a second fit).

**What we built for the hackathon:** Money Moves has used NEAR since day one, for swaps and for Bitcoin and Tron deposits. For the hackathon, NEAR went much further: it now sits underneath how money comes in and goes out across both products, through NEAR Intents (any coin payments, conversions and swaps), Aurora (deposit addresses) and USDC on NEAR:

1. **Businesses take almost any coin.** A customer pays in USDC, USDT, BTC, ETH, SOL, NEAR, XRP, DOGE and more. A NEAR Intents (1Click) *exact output* quote turns it into the exact price in USDC, delivered to an address made for that one payment.
2. **Stablecoins from more chains.** USDC and USDT payments can be routed through NEAR Intents as well, so a business can be paid from chains it doesn't hold.
3. **Settled in seconds, in local fiat or stablecoins.** A business chooses where its money goes: its bank account in local fiat, its own wallet in USDC, or a Money Moves account. For stablecoin payouts, each payment's money is converted through NEAR Intents into the payout float on the business's chosen chain, and the business is paid out of that money only, never ahead of it.
4. **App deposits from more networks.** In the consumer app, a person can deposit any token from a supported network through Aurora, and it arrives as USDC in their own wallet. USDC and USDT on NEAR are supported too.
5. **Cross-chain swaps** in the app, quoted and settled by NEAR Intents.

All of it is live in production today.

## Try it yourself on NEAR

NEAR is the protocol underneath. Money Moves uses two products built on it: **NEAR Intents**, for any coin payments, conversions and swaps, and **Aurora**, for the app's deposit addresses. It also takes **USDC and USDT on NEAR**.

The quick check runs straight from a fresh clone, with no database and no API keys:

```bash
cd business-api
npm install
npm run near-demo
```

It calls the same code the live products use (`business-api/src/lib/intents.ts`), in quote-only mode: nothing is opened and no funds move. It shows three things, live:

1. **Business checkout in almost any coin.** A $25 checkout priced in USDC, USDT, BTC, ETH, SOL, NEAR, XRP, DOGE and more: how much of each a customer would send for the business to receive exactly 25.00 USDC, and the expected time.
2. **Stablecoins from other chains.** USDC and USDT sent from other networks, turned into USDC for the business.
3. **USDC and USDT on NEAR, into the app.** The route a NEAR deposit takes, arriving as USDC in a Money Moves wallet.

You should see over 20 live quotes. A route marked "needs a larger payment right now" has a temporary minimum, which the checkout also tells the customer. Aurora's deposit addresses need an API key, so they aren't part of this keyless check; that code is in `backend/src/lib/aurora-deposits.ts`.

Each package also compiles from a clean checkout:

```bash
cd business-api && npm install && npx prisma generate && npm run typecheck   # Business API
cd business && npm install && npm run build                                  # dashboard and checkout
cd backend && npm install && npx prisma generate && npx tsc --noEmit         # app backend
```

To watch it handle real money, use the live products: open a Money Moves Business payment link and choose "Another coin" at checkout, or deposit USDC on NEAR in the Money Moves app.

## Baseline and hackathon work (please read)

This public repository was created for the NEAR Hackathon. It mirrors our private production monorepo: everything up to 18 October 2026 is one baseline commit; every commit made since, during the hackathon window, follows it with its original date and message.

| Tag | What it is |
|---|---|
| [`pre-hackathon`](../../tree/pre-hackathon) | The code as of **18 October 2026**, the last commit before the hackathon window. **Baseline: already-done work.** |
| [`main`](../../tree/main) | The code as submitted, kept up to date until the deadline. |

**Everything the judges should assess is the difference between the baseline and `main`:** [compare `pre-hackathon...main`](../../compare/pre-hackathon...main).

Disclosed prior work, present in the baseline:
- The Money Moves app, its backend, Money Moves Business, the admin console, the developer API and SDK (built from April 2026).
- `backend/src/routes/intents.ts`: an early 1Click quote for Bitcoin and Tron USDT deposits (July 2026).

Built since 19 October 2026: everything listed under "Where the NEAR work is" below. Each commit from the window is here, and the compare view lists them all.

`google-services.json` (Android Firebase config) is left out of every commit. Nothing else differs from production.

## Where the NEAR work is

To see each piece, open these files.

### Money Moves Business (`business-api/`, `business/`)

| To see | Open |
|---|---|
| The NEAR Intents 1Click client: exact output quotes, status, deposit submit, conversion quotes, which coins and chains are offered | `business-api/src/lib/intents.ts` |
| A checkout paid in another coin; USDC/USDT routed through Intents; finding the customer's deposit on their chain and handing it to 1Click; showing the customer paid as soon as enough arrives | `business-api/src/services/intent-in.ts` |
| Payouts paid from the customer's own money: each payment swept into the payout float, converted through NEAR Intents when the coin or chain differs (`sweepPlan`, `followConversions`, `earlierSweepLanded`) | `business-api/src/services/crypto-out.ts` |
| The payout waits for its own payment's money and never spends another payout's (`moneyFor`, `spareInFloat`); the payout chain rule (`payoutChain` in `lib/platform.ts`) | `business-api/src/services/payments.ts` |
| The checkout endpoints: coins offered per checkout, opening a payment in another coin, the swap's progress | `business-api/src/routes/pay.ts` |
| The checkout page: "Another coin" picker with each coin's logo, the swap screen (Send, Received, Paid) | `business/src/pages/checkout.tsx` |
| What the business sees: "Confirming / Arriving", what the customer actually paid with, the transaction on its explorer | `business/src/pages/transactions.tsx`, `business-api/src/routes/money.ts` |
| Admin switches: other coins on or off, each coin, stablecoins through Intents, our swap fee | `web/src/pages/admin/business/Services.tsx` |
| Schema for the swap and the payout funding | `business-api/prisma/migrations/20261108090000_intent_payments`, `20261108130000_payouts_from_payments` |

### The Money Moves app (`backend/`, `app/`, `services/`)

| To see | Open |
|---|---|
| NEAR Intents clients: swap quotes (1Click) and persistent deposit addresses | `backend/src/lib/aurora.ts` |
| Deposits of any token from a supported network, through Aurora, arriving as USDC in the person's own wallet; one shared EVM address told apart by coin; payouts paired per address | `backend/src/lib/aurora-deposits.ts` |
| Per-network switches (on, paused or hidden) and minimums | `backend/src/lib/aurora-settings.ts`, `web/src/pages/admin/SwapSettings.tsx` |
| Cross-chain swaps through NEAR Intents | `backend/src/lib/aurora-swap.ts`, `backend/src/routes/swap.ts`, `app/swap.tsx` |
| The deposit screens: converted networks in the USDC and USDT network lists, NEAR among them | `app/deposit.tsx`, `app/select-crypto.tsx`, `services/routed-deposits.ts` |

## Agent Economy

AI agents can already pay and get paid with Money Moves:

- **Pay.** The Money Moves plugin for PayBox lets an assistant in ChatGPT, Claude or any MCP client pay a Money Moves payment link, invoice or store QR. The agent reads the checkout, tells the person who they're paying and how much, opens the payment and proposes the exact transfer to that payment's own address. The person approves it in PayBox. Agent payments are made in USDC on Solana today.
- **Get paid.** A business can run its own checkout from the same assistant: make payment links and invoices, and follow its payments. The developer API and webhooks give any agent the same.
- **With NEAR.** The checkouts agents pay are the same ones that take almost any coin through NEAR Intents and settle in seconds, so a business reached by agents is also open to customers paying in USDC, USDT, BTC, ETH, SOL, NEAR and more.

| To see | Open |
|---|---|
| The plugin agents use | `paybox-plugin/src/money-moves.ts` |
| How to connect an assistant and pay | `developers/src/pages/agents.tsx` ([docs.usemoneymoves.xyz/agents](https://docs.usemoneymoves.xyz/agents)) |

## How a payment in another coin works

```
Customer picks "Another coin" → BTC
  → business-api asks 1Click for an EXACT_OUTPUT quote:
      origin BTC, destination USDC on the payout chain, amount = the price,
      recipient = an address made for this payment, refunds to our NEAR Intents account
  → customer sends BTC to the 1Click deposit address
  → we spot it on their chain and hand the transaction to 1Click (it starts at once)
  → the checkout shows "Paid" as soon as enough has arrived
  → solvers swap; USDC lands at the payment's address; our scanner confirms the payment
  → the payment's USDC is swept into the payout float, and the business is paid
     (to its bank in local currency, to its own wallet, or to a Money Moves account)
```

## Run it locally

Each package is a normal Node project. You need Node 22 and PostgreSQL.

```bash
# Money Moves Business API
cd business-api && cp .env.example .env    # fill in DATABASE_URL and the rest
npm install && npx prisma migrate deploy && npm run dev

# Business dashboard and checkout (talks to the API on :4100)
cd business && npm install && npm run dev  # http://localhost:5174

# App backend
cd backend && cp .env.example .env && npm install && npx prisma migrate deploy && npm run dev

# The app (Expo)
npm install && npx expo start
```

NEAR Intents needs `ONECLICK_API_KEY` (optional; 1Click works without one at a small fee) and `INTENTS_ACCOUNT` (our account on NEAR Intents, for refunds and our fee) on the Business API, and `AURORA_INTENTS_API_KEY` / `ONECLICK_API_KEY` on the app backend. Test mode in the dashboard runs every payment on a simulator, so the checkout can be tried without real money.

## Built with

- **NEAR Intents**: the 1Click API (swaps, checkout quotes, status, deposit submit) and Aurora's Intents API (persistent deposit addresses)
- TypeScript, Node.js, Express, Prisma, PostgreSQL
- React, Vite, Tailwind (dashboard and checkout); React Native and Expo (app)
- ethers, @solana/web3.js

More about the products: [`docs/PRODUCT.md`](docs/PRODUCT.md).

## Other submission by the same builder

This builder is also submitting **Sotechy**, a separate, independent project with its own code: [github.com/soke-dev/Sotechy-App/tree/near-hackathon](https://github.com/soke-dev/Sotechy-App/tree/near-hackathon). The two share no code and should be judged independently.

## License

MIT, see [`LICENSE`](LICENSE).
