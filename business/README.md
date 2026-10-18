# Money Moves Business

The merchant dashboard and the customer checkout. Businesses take payments by payment link, invoice, store QR code or API. Customers pay by bank transfer, with one tap in the Money Moves app, or in stablecoins. Each payment settles to the business's bank account, its Money Moves account or its own self-custodial wallet.

The dashboard talks to [`business-api`](../business-api), which has its own database.

```bash
npm install
npm run dev        # http://localhost:5174, with /api proxied to http://localhost:4100
npm run build
```

Run `business-api` alongside it (see its README). Every new business starts in **test mode**, which runs on a simulator and never touches real money.

## Preview without the API

Add `?demo=` to any address to open the dashboard with sample data, and no backend:

| Link | Opens |
| --- | --- |
| `/dashboard?demo=b_movers` | A verified business in live mode |
| `/dashboard?demo=b_okotete` | A business whose documents are in review |
| `/dashboard?demo=new` | A new, unverified business in test mode |
| `/pay/demo?demo=1` | The customer checkout |

A build made with `VITE_API_MODE=preview` behaves the same way. All sample data lives in `src/data/mock.ts`, and every name and email in it is made up.

## Pages

- **Getting in:** sign up, log in (email and password with a six-digit code, or Google), forgot password, choose a business
- **Setting up:** onboarding, identity and business verification, a new business
- **Money in:** payments, refunds and disputes, customers, payment links, invoices, store outlets, deposit addresses
- **Money out:** settlements, the business wallet, payouts and beneficiaries
- **Developers:** API keys, webhooks, events, logs, IP allowlist
- **Settings:** business details, settlement, compliance, branding, team and roles
- **Checkout:** `/pay/:slug`, the customer's side

## Layout

```
src/
  components/   shared UI: buttons, fields, tables, modals, checkout pieces
  layouts/      the app shell (sidebar, business switcher, banners) and the sign-in layout
  pages/        one file per area
  lib/          API client and links
  state/        session, compliance and settlement state
  data/mock.ts  sample data for preview mode
```
