import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { C, Page } from '@/components/docs'

type Entry = { title: string; body: ReactNode }
type Week = { week: string; entries: Entry[] }

const p = 'mt-3 text-[15.5px] leading-[1.75] text-body'

const WEEKS: Week[] = [
  {
    week: 'Week of Nov 2, 2026',
    entries: [
      {
        title: 'Customers can pay with almost any coin',
        body: (
          <>
            <p className={p}>
              Crypto checkouts can offer Another coin: Bitcoin, Ether, SOL, NEAR, XRP, Dogecoin and more. It's swapped to the exact price in USDC on the way, through NEAR Intents, and settles like any other crypto payment. A payment's{' '}
              <C>crypto.paid_with</C> shows what the customer sent. <Link to="/payment-methods">Paying with another coin</Link>
            </p>
            <p className={p}>USDC and USDT can also be routed through NEAR Intents, so customers can pay from more chains, with nothing changing on your side.</p>
          </>
        ),
      },
      {
        title: 'Payouts from each payment, on Solana or Monad',
        body: (
          <>
            <p className={p}>
              Every crypto payout is now paid out of that payment's own money. USDC payouts go out on Solana or Monad; businesses that chose Arc, Movement or Stellar receive on Monad for now, at the same address. Bank payouts are unchanged. <Link to="/settlement">Settlement</Link>
            </p>
          </>
        ),
      },
    ],
  },
  {
    week: 'Week of Oct 19, 2026',
    entries: [
      {
        title: 'A PHP SDK and a WooCommerce plugin',
        body: (
          <>
            <p className={p}>
              <C>moneymoves/sdk</C> for PHP covers every endpoint, on PHP 7.4 or later with no dependencies beyond <C>curl</C> and <C>json</C>. Lists have an <C>each</C> generator that walks every page, and <C>webhooks-&gt;constructEvent</C> checks a
              signature in one call. <Link to="/php">Get started with the PHP SDK</Link>
            </p>
            <p className={p}>
              The Money Moves Payments plugin for WooCommerce adds bank transfer, Money Moves app and stablecoin payments to your store's checkout, classic or block, and marks each order paid from our signed webhook. <Link to="/woocommerce">Set up WooCommerce</Link>
            </p>
          </>
        ),
      },
      {
        title: 'Choose where API payments settle, and switch methods on and off',
        body: (
          <>
            <p className={p}>
              In the Developer portal you can now send API payments to a bank account, your Money Moves account or your business wallet, each the moment it's paid. A checkout's own <C>settle_to</C> still wins. <Link to="/settlement">Settlement</Link>
            </p>
            <p className={p}>
              Each method is on once it has somewhere to settle, and can be switched off in Settings, Payment methods. An API checkout that asks for a method that's off gets <C>method_off</C>. <Link to="/payment-methods">Methods, coins and networks</Link>
            </p>
          </>
        ),
      },
    ],
  },
  {
    week: 'Week of Oct 12, 2026',
    entries: [
      {
        title: 'Disputes, in the dashboard, the API and the SDK',
        body: (
          <>
            <p className={p}>
              Customers can now dispute a payment from their receipt, and follow it there. You reply or refund from the dashboard, and attach proof. A customer has 3 days to accept your reply or answer; deadlines close it either way. Bank claims on bank
              transfers show up the same way.
            </p>
            <p className={p}>
              The API lists and retrieves disputes with their conversation, and takes your reply. With a test key you can open a test dispute and have the customer accept it. New webhooks: <C>dispute.created</C>, <C>dispute.updated</C> and{' '}
              <C>dispute.closed</C>. <C>@moneymoves/sdk</C> 1.1.0 adds <C>mm.disputes</C>.
            </p>
            <p className={p}>
              <Link to="/api/disputes">Read the disputes reference</Link>
            </p>
          </>
        ),
      },
      {
        title: 'The official Node.js SDK',
        body: (
          <>
            <p className={p}>
              <C>@moneymoves/sdk</C> covers every endpoint with typed objects, and works with both <C>import</C> and <C>require</C> on Node.js 18 or later, with no runtime dependencies. Every list has an <C>each</C> method that walks all the pages for
              you, and <C>webhooks.constructEvent</C> checks a webhook's signature in one line.
            </p>
            <p className={p}>
              Reads are retried on network errors and 5xx. Writes are sent once: if a response is lost, the SDK tells you the outcome is unknown so you can check before trying again. Give a write an idempotency key and it's retried safely.
            </p>
            <p className={p}>
              <Link to="/sdk">Get started with the Node.js SDK</Link>
            </p>
          </>
        ),
      },
      {
        title: 'We warn you when a webhook endpoint keeps failing',
        body: (
          <>
            <p className={p}>
              If every delivery to one of your endpoints fails for 24 hours, we now email your account's owner and admins. The email names the endpoint, says when it started failing, and gives the date we'll turn it off.
            </p>
            <p className={p}>
              If it's still failing after 72 hours, and at least 48 hours after that email, we turn the endpoint off and email you again. One successful delivery resets the count. Before this, nothing told you an endpoint was failing unless you watched
              the Events tab.
            </p>
            <p className={p}>
              To turn an endpoint back on, open it under Webhooks in the developer portal. Events from while it was off aren't sent on their own, so resend the ones you need. <Link to="/webhooks/retries">Retries and delivery</Link>
            </p>
          </>
        ),
      },
      {
        title: 'API v1 now supports the full payment flow',
        body: (
          <>
            <p className={p}>
              The API now supports more of the payment lifecycle from your server. Checkouts can include customer details, <C>metadata</C>, an expiry, a fee payer, accepted crypto and a settlement destination. You can also list checkouts by reference and cancel unpaid checkouts.
            </p>
            <p className={p}>
              New endpoints let you retrieve <Link to="/api/payments">payments</Link> by ID or customer-facing reference, track <Link to="/api/settlements">settlements</Link> and <Link to="/api/refunds">refunds</Link>, check your{' '}
              <Link to="/api/balance">balance</Link> and the current <Link to="/api/rates">exchange rate</Link>, and retrieve <Link to="/api/events">events</Link>.
            </p>
            <p className={p}>
              Errors use a consistent <C>{'{ "error": { "code", "message", "request_id" } }'}</C> response format. Each response also includes an <C>mm-request-id</C> header that matches the request in dashboard Logs.
            </p>
            <p className={p}>
              <Link to="/api">API introduction</Link> · <Link to="/api/checkouts">Checkouts</Link> · <Link to="/errors">Errors</Link>
            </p>
          </>
        ),
      },
      {
        title: 'Webhooks, logs and safer retries',
        body: (
          <>
            <p className={p}>
              Add endpoints under Developer portal → Webhooks, choose which events to receive, and send a test event to verify your setup. Every event includes an <C>mm-signature</C> header. If your server doesn't return a 2xx response, we make up to five more attempts over about a day. You can also resend a delivery from the Events tab.
            </p>
            <p className={p}>
              Logs retain API requests and responses for 30 days. Include an <C>Idempotency-Key</C> on POST requests so a retry returns the original response instead of repeating the operation.
            </p>
            <p className={p}>
              <Link to="/webhooks">Webhooks</Link> · <Link to="/webhooks/signatures">Verifying signatures</Link> · <Link to="/idempotency">Idempotency</Link>
            </p>
          </>
        ),
      },
      {
        title: 'Live keys',
        body: (
          <>
            <p className={p}>
              Verified businesses can create live keys. The API base URL stays the same; use the key for the mode you want.
            </p>
          </>
        ),
      },
      {
        title: 'AI agents can pay Money Moves businesses',
        body: (
          <>
            <p className={p}>
              The Money Moves plugin for PayBox lets an AI assistant like Claude or ChatGPT pay a payment link, invoice or store QR in USDC on Solana, after the customer approves the transfer in PayBox. A business's agent can also create checkouts, retrieve payments and check its balance. Payments use the same webhooks and settlement flow as other crypto payments.
            </p>
            <p className={p}>
              <Link to="/agents">AI agents</Link>
            </p>
          </>
        ),
      },
    ],
  },
  {
    week: 'Week of Oct 5, 2026',
    entries: [
      {
        title: 'Crypto payments use dedicated addresses',
        body: (
          <>
            <p className={p}>
              Each crypto payment gets a dedicated address on Movement, Solana, Base, BNB Chain, Arbitrum, Optimism, Monad and Arc. Customers don't need to send an exact amount, and payments stay separate. Stellar and TON use a shared address with a memo.
            </p>
            <p className={p}>
              Late crypto payments are still recorded, and excess funds are set aside for return to the customer. Crypto settles as USDC on the network you choose.
            </p>
            <p className={p}>
              <Link to="/payment-methods">Methods, coins and networks</Link> · <Link to="/settlement">Settlement</Link>
            </p>
          </>
        ),
      },
    ],
  },
  {
    week: 'Week of Sep 28, 2026',
    entries: [
      {
        title: 'Prices in local fiat',
        body: (
          <p className={p}>
            Payment links, store QR codes and checkouts can be priced in local currency or USD. The checkout shows the converted amount at the current rate and fixes that rate when payment begins. <Link to="/currencies">Local fiat and dollars</Link>
          </p>
        ),
      },
    ],
  },
  {
    week: 'Week of Sep 14, 2026',
    entries: [
      {
        title: 'API v1',
        body: <p className={p}>The first API version lets you create a checkout from your server with a test key, send the customer to its payment page, and retrieve it to confirm payment.</p>,
      },
    ],
  },
]

export function Changelog() {
  return (
    <Page title="Product updates" lead="New features and improvements to Money Moves Business, listed newest first. Updates are backward-compatible unless noted otherwise.">
      <div className="space-y-14">
        {WEEKS.map((w, i) => (
          <section key={w.week} className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-[170px_1fr]">
            <div>
              <span className="inline-block rounded-[7px] bg-accent-bg px-2.5 py-1 text-[13px] font-medium text-accent md:sticky md:top-[130px]">{w.week}</span>
            </div>
            <div className="min-w-0 space-y-11">
              {w.entries.map((e, j) => (
                <div key={e.title}>
                  <h2 id={`entry-${i}-${j}`} className="scroll-mt-32 text-[21px] font-semibold tracking-[-0.018em] text-fg">
                    {e.title}
                  </h2>
                  <div>{e.body}</div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Page>
  )
}
