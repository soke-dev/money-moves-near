<div align="center">
  <img src="web/public/images/logo.png" alt="Money Moves" width="80" />
  <h1>Money Moves</h1>
  <p><strong>The smarter way to move money.</strong></p>
  <p>
    A self-custodial money app for holding, sending, spending and converting stablecoins,
    and a business platform for getting paid however customers want to pay.
  </p>
  <p>
    <a href="https://usemoneymoves.xyz">usemoneymoves.xyz</a> ·
    Live on iOS and Android
  </p>
</div>

---

## Where we are

| | |
|---|---|
| **₦60M+** | volume processed since April 2026 |
| **2,200+** | completed transactions |
| **500+** | mobile downloads |
| **82%** | of people who transact come back |

## What it is

Millions of people save in stablecoins to protect themselves from weak local currencies. Spending that money is slow, and most apps that make it easy hold your funds for you. Money Moves keeps the money in the user's own wallet and puts everything they need to use it in one app: bank cash-outs, bills, transfers by @username and savings.

**Money Moves Business** gives businesses everything they need to move money: payments from customers (B2C), invoices to other businesses (B2B), instant settlement, payouts to suppliers and staff, and an API so platforms and SaaS products can take payments for their users. Customers pay by bank transfer, with one tap in the Money Moves app, or in stablecoins from any wallet. Like the app, the business wallet is self-custodial.

## The app

| | |
|---|---|
| **Sign in with email** | No seed phrase. The wallet is ready in seconds |
| **Self-custodial** | The key is split, so nobody holds all of it, including us. Users can export it to any wallet |
| **Onramp and offramp** | Local currency to stablecoins by bank transfer, and back again |
| **Bank withdrawals** | To any bank account, typically in seconds |
| **Send by @username** | No long wallet addresses to copy |
| **Bills** | Airtime, data, electricity, TV and betting |
| **Savings** | Lock money away until a date you choose |
| **Gift vouchers** | Send money anyone can claim, even without the app |
| **Pay businesses** | Scan a store's QR code or approve a payment request |
| **Referrals and points** | Invite friends and earn points on everything you move |
| **No gas fees** | We pay the network fee on every transaction |
| **Security** | Face ID or a PIN before any money leaves |

## Money Moves Business

| | |
|---|---|
| **Payment links (B2C)** | Built on one page with a live preview, ready to share in a minute |
| **Invoices and deposit addresses (B2B)** | Bill another business by email, or give each client its own address to pay into |
| **Store QR codes** | A poster for the till. Customers scan, enter the amount and pay |
| **Three ways to pay** | A bank transfer to a one-time account, one tap in the app (free), or stablecoins |
| **Settlement** | Paid out per payment to a bank account, a Money Moves account or the business's own self-custodial wallet |
| **Payouts** | Pay suppliers and staff from the business wallet, to saved beneficiaries |
| **Refunds and receipts** | Customers get a downloadable receipt. Short or late payments are caught and refunded |
| **Test mode** | Every business starts in test mode, with a simulator that never touches real money |
| **API for platforms and SaaS** | A checkout API, webhooks and secret test keys |
| **Teams** | Team members with roles, an audit log and an IP allowlist |
| **Support** | Live chat with our team, inside the dashboard |
| **Verification** | Identity and business documents reviewed by our team |

**Fees:** 0.5% on bank transfer payments (capped at ₦1,000), 0.5% on stablecoin payments (capped at $1), free through the Money Moves app, and ₦100 per payout from the business wallet.

## Repo layout

```
money-moves/
├─ app/            # Expo Router screens: the mobile app
├─ components/     # Shared React Native components
├─ services/       # API clients, wallet, balances, savings and more
├─ context/        # React contexts
├─ contracts/      # Smart contracts (savings vault)
├─ backend/        # The app's API (Node, TypeScript, Prisma, Postgres)
├─ business/       # Money Moves Business dashboard and checkout (Vite + React)
├─ business-api/   # Money Moves Business API, with its own database
├─ developers/     # Developer docs site
├─ web/            # Landing site and the admin console
└─ assets/         # Icons, fonts and images
```

The app and Money Moves Business are separate services with separate databases. They only talk to each other through a narrow internal API.

## Tech stack

- **App:** Expo SDK 54, React Native 0.81, React 19, Expo Router 6
- **Wallet:** self-custodial, with the key split across parties; biometric and PIN unlock
- **Backends:** Node.js and TypeScript, Prisma and Postgres
- **Web:** Vite, React and Tailwind for the business dashboard, the docs and the landing site

## Getting started

You need Node.js 20+ and npm 10+. For mobile builds, you also need the Expo CLI (`npx expo`) and Android Studio or Xcode.

```bash
git clone https://github.com/<your-org>/money-moves.git
cd money-moves
npm install
```

### The app

```bash
npm run start         # Expo dev server
npm run android       # Android emulator or device
npm run ios           # iOS simulator
```

### The app's backend

```bash
cd backend
npm install
cp .env.example .env  # fill in your own values
npx prisma migrate dev
npm run dev           # http://localhost:4000
```

### Money Moves Business

```bash
cd business-api
npm install
cp .env.example .env  # use a fresh local Postgres, never the app's database
npx prisma migrate dev
npm run dev           # http://localhost:4100

cd ../business
npm install
npm run dev           # http://localhost:5174
```

### Docs site and landing site

```bash
cd developers && npm install && npm run dev   # http://localhost:5176
cd web && npm install && npm run dev          # http://localhost:5173
```

Secrets never go in git. Only the `.env.example` files are committed.

## Compliance

- Registered with the Corporate Affairs Commission
- NDPC certificate for data protection
- DUNS number
- SCUML registration submitted
- Bank payments go through licensed providers

## License

Proprietary. © 2026 Money Moves. All rights reserved.
