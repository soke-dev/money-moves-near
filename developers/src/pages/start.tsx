import { Link } from 'react-router-dom'
import { Accordion, Block, C, Code, H2, H3, Next, Note, OL, P, Page, Step, Steps, Table, UL } from '@/components/docs'
import { CHECKOUT, Request, Response } from '@/components/api'
import { FlowArt } from '@/components/FlowArt'
import { API_BASE, DASHBOARD_URL } from '@/nav'

/* ─── Introduction ─────────────────────────────────────────────────── */

export function Introduction() {
  return (
    <Page title="Get paid. Settle instantly." lead="Accept payments in local fiat or crypto. Each confirmed payment is sent to your chosen destination for settlement straight away.">
      <P>
        Money Moves Business brings local fiat and crypto payments together in one checkout. Customers can pay from a bank account, crypto wallet or the Money Moves app. Choose where funds settle: local currency in your bank account or USDC in a self-custody wallet controlled by your business.
      </P>
      <P>
        Payments aren't held for a payout schedule or grouped into batches. Once a payment is confirmed, settlement starts automatically and your server receives a webhook.
      </P>
      <P>
        You can also refund customers using their original payment method, send funds from your wallet to a bank account or crypto address, accept payments from AI assistants like Claude and ChatGPT through PayBox, and integrate payments into your product with one API.
      </P>
      <FlowArt />

      <H2>What is Money Moves Business?</H2>
      <P>
        Money Moves Business combines hosted checkout, settlement and an API in one account. You can take payments without writing code by creating payment links, invoices and store QR codes in the dashboard, or integrate payments into your site or app with the API.
        In either case, we confirm the payment with the bank or on the blockchain, then send the funds to your chosen settlement destination.
      </P>
      <P>
        Every business has test and live modes. Test mode is available as soon as you sign up and uses simulated payments. Its API objects, statuses and events match live mode, so you can build and test your integration before verification. Live mode is available after your business is verified.
      </P>
      <Note>Money Moves Business is separate from the Money Moves app. Your business has its own account, team, verification and records. The app is one of the ways your customers can pay you, and one of the places your money can settle.</Note>

      <H2>Instant settlement</H2>
      <P>
        We don't hold your money and pay it out later. Every payment settles on its own the moment it's confirmed, with no daily batch, no cut-off time and no minimum to reach. A transfer at 9pm on a Sunday is in your bank account at 9pm on a Sunday. Your
        server hears about it in the same moment, by webhook.
      </P>

      <H2>Self custody</H2>
      <P>
        If you'd rather keep what you earn in stablecoins, settle to your business wallet. It's a self-custody wallet: your business holds the keys, not Money Moves. We can't spend from it or move money out of it. Only the owner can send from
        it, with their sign-in and transfer PIN, and they can export it to any other wallet app whenever they like. See <Link to="/business-wallet">Business wallet</Link>.
      </P>

      <H2>What Money Moves handles</H2>
      <Accordion
        items={[
          [
            'Taking payments',
            <>
              <p>
                For a bank transfer, each payment gets a one-time account for exactly that amount, so it's matched the moment it lands, with no reference for the customer to type. For crypto, each payment gets an address of its own on the network the customer
                picked (Stellar and TON use our address with a memo). For the Money Moves app, the customer approves the payment in the app with one tap or a scan.
              </p>
              <p className="mt-3">If less than the amount arrives, the payment is held as underpaid instead of settling. If nothing arrives in time, it expires. The customer gets a receipt by email either way.</p>
            </>,
          ],
          [
            'Settlement',
            <>
              <p>
                Each paid payment settles straight away, on its own: local fiat to a bank account in your business's name, or USDC to a linked Money Moves account or your self-custody business wallet. There are no daily batches to wait for. Crypto always settles as USDC on
                the chain you choose, whatever coin and network the customer paid with.
              </p>
            </>,
          ],
          [
            'Refunds',
            <>
              <p>Send money back the way the customer paid: to their bank, their Money Moves app, or the wallet they paid from. You fund each refund with a transfer, less our fee on the refunded part, which we give back.</p>
            </>,
          ],
          [
            'The API and the dashboard',
            <>
              <p>
                Checkouts, payments, settlements, refunds, balances, rates and events through a REST API, with signed webhooks and idempotency keys. In the dashboard you get every payment and settlement, your API keys, request logs, webhook
                deliveries and a team with roles.
              </p>
            </>,
          ],
          [
            'AI agents',
            <>
              <p>
                With the <Link to="/agents">Money Moves plugin for PayBox</Link>, an assistant like Claude or ChatGPT can pay any Money Moves payment link, invoice or store QR in USDC, with the customer approving every payment. Your own assistant can make
                checkouts and read your payments.
              </p>
            </>,
          ],
        ]}
      />

      <H2>Who is it for?</H2>
      <P>
        Money Moves Business is for anyone who sells something and wants to be paid without chasing transfers. A registered business can take payments from ₦100 to ₦1,000,000 each, settle to its bank, add a team and use every part of the API.
        A freelancer or sole trader can sign up as an individual, take payments from ₦100 to ₦500,000 each, and settle to their business wallet.
      </P>
      <P>If you're a developer building for a business, you'll spend most of your time in the API reference and the webhooks guide. If you run the business, the guides on payment links, invoices, store QRs and settlement are the place to start.</P>

      <H2>How these docs are organised</H2>
      <Table
        head={['Tab', "What's there"]}
        rows={[
          ['Guides', 'How payments, settlement and refunds work, how to go live, fees, statuses, errors and limits.'],
          ['API reference', 'Every endpoint, every field, with requests in cURL, Node.js and Python and the exact responses.'],
          ['Webhooks', 'Setting up an endpoint, every event we send, checking signatures, and what happens when your server is down.'],
          ['Changelog', 'What changed and when, newest first.'],
        ]}
      />

      <Next
        links={[
          ['/quickstart', 'Quickstart', 'make a test checkout and pay it in about ten minutes.'],
          ['/how-payments-work', 'How payments work', 'the life of a payment, from checkout to settlement.'],
          ['/api', 'API reference', 'base URL, keys, errors and every endpoint.'],
          ['/webhooks', 'Webhooks', 'hear about payments the moment they happen.'],
        ]}
      />
    </Page>
  )
}

/* ─── Quickstart ───────────────────────────────────────────────────── */

const SERVER = `import express from "express";
import crypto from "crypto";

const app = express();
const API = "${API_BASE}";
const KEY = process.env.MONEYMOVES_SECRET_KEY;

// 1. Make a checkout for an order, on your server.
app.post("/pay", express.json(), async (req, res) => {
  const orderId = "order_" + crypto.randomUUID().slice(0, 8);
  const r = await fetch(\`\${API}/checkouts\`, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${KEY}\`,
      "Content-Type": "application/json",
      "Idempotency-Key": orderId,
    },
    body: JSON.stringify({
      amount: 5000,
      currency: "NGN",
      reference: orderId,
      customer: { email: req.body.email },
      redirect_url: \`https://yourshop.com/orders/\${orderId}\`,
    }),
  });
  const checkout = await r.json();
  res.json({ url: checkout.url });
});

// 2. Hear about the payment.
app.post("/webhooks/money-moves", express.raw({ type: "application/json" }), (req, res) => {
  const { t, v1 } = Object.fromEntries(req.get("mm-signature").split(",").map((p) => p.split("=")));
  const expected = crypto.createHmac("sha256", process.env.MONEYMOVES_WEBHOOK_SECRET).update(\`\${t}.\${req.body}\`).digest("hex");
  if (expected !== v1) return res.sendStatus(400);

  const event = JSON.parse(req.body);
  res.sendStatus(200);
  if (event.type === "payment.successful") {
    console.log("Paid:", event.data.object.checkout_reference);
  }
});

app.listen(3000);`

export function Quickstart() {
  return (
    <Page title="Quickstart" lead="Make a test checkout from your server, pay it with pretend money, and hear about it by webhook. About ten minutes from start to finish.">
      <P>You don't need a verified business to follow this guide. The steps use test mode, so no real payments or transfers occur. The same integration will work in live mode when you're ready to go live.</P>
      <H2>What you need</H2>
      <UL>
        <li>
          A Money Moves Business account. <a href={`${DASHBOARD_URL}/signup`}>Sign up</a> if you don't have one. Test mode is available as soon as you sign up.
        </li>
        <li>A server that can run code. The examples use Node.js 18 or later, but any language that can make HTTPS requests will work.</li>
        <li>To receive webhooks, a public HTTPS address for your server. During development, you can use a tunnel such as ngrok.</li>
      </UL>

      <H2>Take your first payment</H2>
      <Steps>
        <Step title="Create a test key">
          <P>
            In the dashboard, select <b>Test mode</b>, then open <a href={`${DASHBOARD_URL}/settings/api-keys`}>Developer portal → API keys</a> and create a test key. Give it a name that identifies where you'll use it, such as "Shop server". The key
            is shown only once, so save it directly to your server's environment as <C>MONEYMOVES_SECRET_KEY</C>.
          </P>
          <P>Check it works by asking whose key it is:</P>
          <Request method="GET" path="/account" />
          <Response data={{ object: 'account', merchant_id: 'MM-7Q2K9P', name: 'Ada Shoes', mode: 'test', verified: false, key: { name: 'Shop server', prefix: 'sk_test_A1b2C3' } }} />
        </Step>
        <Step title="Make a checkout">
          <P>
            A checkout contains the amount and a hosted payment page. Create one on your server for each order. Use your order ID as both the <C>reference</C> and the <C>Idempotency-Key</C> so a retry doesn't create a duplicate checkout.
          </P>
          <Request method="POST" path="/checkouts" idempotent body={{ amount: 5000, currency: 'NGN', reference: 'order_1042', customer: { email: 'ada@example.com' }, redirect_url: 'https://yourshop.com/orders/order_1042' }} />
          <Response status={201} data={{ ...CHECKOUT, mode: 'test', url: 'https://pay.usemoneymoves.xyz/test-co-a70cfb772b66' }} />
        </Step>
        <Step title="Pay it">
          <P>
            Open the checkout's <C>url</C> in a browser. The test banner and payment buttons let you simulate a full or partial payment. Select bank transfer and choose the full-payment option. After payment, the customer is sent to your <C>redirect_url</C>.
          </P>
        </Step>
        <Step title="Hear about it">
          <P>
            Add your server's address under <a href={`${DASHBOARD_URL}/settings/webhooks`}>Developer portal → Webhooks</a>, for example <C>https://yourshop.com/webhooks/money-moves</C>, and save the test signing secret as{' '}
            <C>MONEYMOVES_WEBHOOK_SECRET</C>. Pay another checkout. Your server will receive <C>payment.successful</C>, followed by <C>settlement.completed</C>.
          </P>
          <P>If you haven't set up a webhook yet, retrieve the checkout to check its status. When it's paid, the response includes the payment:</P>
          <Request method="GET" path={`/checkouts/${CHECKOUT.id}`} />
        </Step>
      </Steps>

      <H2>The whole thing in one file</H2>
      <P>This Express example handles both parts of the flow: it creates a checkout when your site requests one, then verifies and processes the webhook when the payment is confirmed.</P>
      <Code tabs={[{ label: 'server.js', lang: 'js', code: SERVER }]} />
      <Note type="tip" title="See a full working shop">
        Kòkó Coffee is a demo shop built on exactly this flow, with a mobile app that buys from it. Its source is in the Money Moves repository under <C>demo/store</C> and <C>demo/mobile</C>.
      </Note>

      <H2>When something doesn't work</H2>
      <Accordion
        items={[
          [
            'The API says no_key or bad_key',
            <>
              The header has to be exactly <C>Authorization: Bearer sk_test_…</C>, with the whole key. A revoked key stops working at once. Create a new one if you're not sure which key your server has.
            </>,
          ],
          [
            'The API says browser_not_allowed',
            <>You're calling the API from a web page or an app. Secret keys only work from a server. Have your page ask your server, and your server ask us.</>,
          ],
          [
            "My webhook never arrives",
            <>
              Open Developer portal → Events. Every delivery is listed with what your server answered. Check the address is public HTTPS, that your server answers within 10 seconds, and that the endpoint is in test mode for test payments.
            </>,
          ],
          ['The signature check fails', <>Check the signature against the raw request body, before any JSON parsing, and use the signing secret for the same mode as the payment. Test and live have different secrets.</>],
        ]}
      />

      <Next
        links={[
          ['/checkout', 'Checkout', 'everything a checkout can do, from metadata to expiry.'],
          ['/webhooks/signatures', 'Verifying signatures', 'the signature check, step by step.'],
          ['/go-live', 'Go live', 'swap in a live key and take real payments.'],
        ]}
      />
    </Page>
  )
}

/* ─── Authentication ───────────────────────────────────────────────── */

export function Authentication() {
  return (
    <Page title="Authentication" lead="Every request carries a secret key in the Authorization header. Keys belong to one mode, work only from a server, and can be revoked at any time.">
      <P>Authenticate each HTTPS request with a bearer token: include your secret key in the <C>Authorization</C> header. You don't need to log in separately or refresh a token.</P>
      <Block lang="http" label="Request" code={`GET /api/v1/account HTTP/1.1
Host: business.usemoneymoves.xyz
Authorization: Bearer sk_test_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0`} />

      <H2>Test keys and live keys</H2>
      <P>Each key is limited to one mode. A test key can only create and read test data; a live key can only access live data. Both modes use the same base URL.</P>
      <Table
        head={['Key', 'Starts with', 'What it does', 'When you can make one']}
        rows={[
          ['Test', <C>sk_test_</C>, 'Makes test checkouts and reads test objects. Nothing real can be paid or moved.', 'As soon as you sign up'],
          ['Live', <C>sk_live_</C>, 'Takes real payments and refunds real money.', 'Once your business is verified'],
        ]}
      />

      <H2>Creating and revoking keys</H2>
      <P>
        Create and manage keys under <a href={`${DASHBOARD_URL}/settings/api-keys`}>Developer portal → API keys</a>. Select test or live mode in the dashboard first; the page then shows keys for that mode and creates new keys in it. You can create up to ten keys per mode, for example one for each server or environment.
      </P>
      <P>
        Each key is displayed only when you create it. We store its hash and prefix, so the full key can't be viewed again. If you lose a key, create a replacement and revoke the old one. Revocation takes effect immediately, and further requests with the old key are rejected.
      </P>
      <P>The Owner, Admins and Developers on your team can create and revoke keys.</P>

      <H2>Keeping keys safe</H2>
      <UL>
        <li>
          <b>Server only.</b> Requests with an <C>Origin</C> header are rejected. Keep secret keys on your server; never put one in a website or mobile app.
        </li>
        <li>
          <b>Out of your code.</b> Keep keys in your host's secret settings or environment variables, never in your repository.
        </li>
        <li>
          <b>Use a separate key for each environment.</b> This makes requests easier to identify in Logs and lets you revoke one key without affecting the others.
        </li>
      </UL>

      <H2>When a key is refused</H2>
      <Table
        head={['Status', 'Code', 'Why']}
        rows={[
          ['401', <C>no_key</C>, <>No key, or not in the form <C>Bearer sk_…</C>.</>],
          ['401', <C>bad_key</C>, 'The key is unknown or has been revoked.'],
          ['403', <C>browser_not_allowed</C>, 'The request came from a browser.'],
          ['403', <C>business_unverified</C>, 'A live key on a business that isn’t verified yet.'],
          ['403', <C>business_suspended</C>, 'The business has been deactivated by Money Moves.'],
          ['503', <C>channel_paused</C>, 'The API is paused for maintenance. Try again shortly.'],
        ]}
      />
    </Page>
  )
}

/* ─── Test mode ────────────────────────────────────────────────────── */

export function TestMode() {
  return (
    <Page title="Test mode" lead="Test payments, webhooks, settlements and refunds without moving real money. Test mode is available as soon as you sign up, before verification.">
      <P>
        Test mode simulates payments, settlements, refunds and webhooks without moving real money. It uses the same objects, statuses and events as live mode, so you can test the integration you'll use in production. Select a mode in the dashboard sidebar; API requests use the mode of the key you send.
      </P>

      <H2>How test mode differs from live</H2>
      <Table
        head={['', 'Test', 'Live']}
        rows={[
          ['Keys', <C>sk_test_</C>, <C>sk_live_</C>],
          ['Bank transfers', 'A one-time account from our simulator. No bank can pay into it.', 'A real one-time account at a bank'],
          ['Crypto', "An address that can't receive anything", 'A real address for this payment'],
          ['Money Moves app', 'Never reaches anyone’s phone', 'Approved by the customer in the app'],
          ['How it gets paid', 'The test buttons on the checkout page', 'The customer pays'],
          ['Settlement', 'Pretend, and done at once', 'Real, the moment it’s paid'],
          ['Webhooks', 'Sent to your test endpoints, signed with your test secret', 'Sent to your live endpoints, signed with your live secret'],
          ['Verification', 'Not needed', 'Needed before live keys work'],
        ]}
      />

      <H2>Pretending a customer paid</H2>
      <P>Test checkout pages display a test banner and buttons to simulate each payment method. Simulate a full or partial payment to check how your integration handles each outcome.</P>
      <UL>
        <li>
          <b>Bank transfer:</b> pay in full, or ₦100 short (half the amount for very small payments).
        </li>
        <li>
          <b>Money Moves app:</b> approve the payment. App payments are always the exact amount, so there's no short option.
        </li>
        <li>
          <b>Crypto:</b> a deposit in full, or a dollar short.
        </li>
      </UL>
      <P>
        Simulated payments trigger the same webhooks as live payments: <C>payment.successful</C> or <C>payment.underpaid</C>. A full payment also triggers <C>settlement.completed</C>.
      </P>

      <H2>Pretending you funded a refund</H2>
      <P>
        A test refund waits for your money, just as a live one does. Instead of making a transfer, call <Link to="/api/refunds#simulate">Simulate funding</Link> or press the button on the refund in the dashboard, and watch it move to processing and then
        completed.
      </P>

      <Note>Test and live never mix. A test key can't read live payments, test webhooks only go to test endpoints, and test checkouts can't receive real money even if someone tries.</Note>
    </Page>
  )
}

/* ─── Go live ──────────────────────────────────────────────────────── */

export function GoLive() {
  return (
    <Page title="Go live" lead="Once your integration works in test mode, switch to a live key to accept real payments. Complete this checklist first.">
      <Steps>
        <Step title="Get your business verified">
          <P>
            Complete verification in the dashboard by providing your business details and documents, along with the account owner's identity details, NIN and selfie. Our team will review your submission and email you when verification is complete. Live mode, live keys and the business wallet become available after approval.
          </P>
        </Step>
        <Step title="Choose where your money goes">
          <P>
            Under Settings → Payout places, add a bank account in your business's name. We verify the account name before sending funds to it. You can also link a Money Moves account with approval from its owner in the app, or create a business wallet. See <Link to="/settlement">Settlement</Link> for details.
          </P>
        </Step>
        <Step title="Create a live key">
          <P>Select live mode in the dashboard, open Developer portal → API keys, and create a live key. Store it on your server in place of the test key. No other code changes are required.</P>
        </Step>
        <Step title="Add your live webhook">
          <P>Live mode has separate webhook endpoints and a separate signing secret. Add your endpoint while live mode is selected, store the live secret on your server, and send a test event to confirm your endpoint responds.</P>
        </Step>
        <Step title="Take a small real payment">
          <P>Create a small checkout and pay it yourself. In the dashboard, confirm that the payment succeeds and the settlement completes. Check that your server receives both events.</P>
        </Step>
      </Steps>

      <H2>Before real money moves</H2>
      <OL>
        <li>Check the signature on every webhook, and refuse anything that doesn't match.</li>
        <li>
          Handle each event once, by its <C>id</C>. The same event can arrive more than once.
        </li>
        <li>Fulfil an order only after confirming successful payment. A visit to your redirect page does not confirm payment.</li>
        <li>Keep your live key and webhook secret out of your code and your repository.</li>
        <li>Give each team member only the access they need. Developers can manage keys and webhooks; Finance can manage refunds.</li>
      </OL>

      <H3>Watching it once it's live</H3>
      <P>
        Developer portal → Logs shows API requests made with your keys, including each request and response. Events shows webhook deliveries and your server's responses; you can resend a delivery from there. Both are retained for 30 days.
      </P>
    </Page>
  )
}
