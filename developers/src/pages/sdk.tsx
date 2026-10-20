import { Link } from 'react-router-dom'
import { Block, C, Code, H2, H3, Next, Note, P, Page, Table, UL } from '@/components/docs'

const SETUP = `import { MoneyMoves } from "@moneymoves/sdk";

// Reads MONEYMOVES_SECRET_KEY when you don't pass a key.
const mm = new MoneyMoves(process.env.MONEYMOVES_SECRET_KEY);`

const REQUIRE = `const { MoneyMoves } = require("@moneymoves/sdk");

const mm = new MoneyMoves(process.env.MONEYMOVES_SECRET_KEY);`

const CHECKOUT = `const checkout = await mm.checkouts.create(
  {
    amount: 5000,
    currency: "NGN",
    reference: "order_1042",
    customer: { email: "ada@example.com" },
    metadata: { cart_id: "c_8812" },
    redirect_url: "https://yourshop.com/orders/1042",
  },
  { idempotencyKey: "order_1042" },
);

// Send the customer to checkout.url`

const READ = `const checkout = await mm.checkouts.retrieve(checkoutId);
if (checkout.status === "paid") {
  console.log("Paid by", checkout.payment.method, checkout.payment.reference);
}

// A payment by its id, or by the reference on the customer's receipt.
const payment = await mm.payments.retrieve("MMB-9DQMDUNU");`

const PAGES = `// One page at a time…
const page = await mm.payments.list({ status: "successful", limit: 50 });

// …or every one, fetched as you go.
for await (const payment of mm.payments.each({ status: "successful" })) {
  console.log(payment.reference, payment.amount_ngn);
}`

const WEBHOOK = `import express from "express";
import { MoneyMoves, webhooks } from "@moneymoves/sdk";

const app = express();

app.post("/webhooks/money-moves", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = webhooks.constructEvent(req.body, req.get("mm-signature"), process.env.MONEYMOVES_WEBHOOK_SECRET);
  } catch {
    return res.sendStatus(400);
  }
  res.sendStatus(200);

  if (event.type === "payment.successful") {
    const payment = event.data.object;
    markOrderPaid(payment.checkout_reference);
  }
});`

const ERRORS = `import { MoneyMovesError, MoneyMovesConnectionError } from "@moneymoves/sdk";

try {
  await mm.refunds.create({ payment: "MMB-9DQMDUNU" });
} catch (e) {
  if (e instanceof MoneyMovesConnectionError && e.outcomeUnknown) {
    // No answer: the refund may or may not exist. Check before asking again.
  } else if (e instanceof MoneyMovesError) {
    console.log(e.status, e.code, e.message, e.requestId);
  }
}`

export function Sdk() {
  return (
    <Page title="Node.js SDK" lead="The official SDK for Node.js: every endpoint with typed objects, pages you can loop over, safe retries, and a one-line webhook signature check.">
      <P>
        <C>@moneymoves/sdk</C> wraps the API so you don't write requests by hand. It works with both <C>import</C> and <C>require</C>, runs on Node.js 18 or later, and has no runtime dependencies. Everything it returns is the same object the API
        returns, typed for TypeScript.
      </P>

      <H2>Install</H2>
      <Block lang="bash" code="npm install @moneymoves/sdk" />
      <P>
        On <a href="https://www.npmjs.com/package/@moneymoves/sdk" target="_blank" rel="noreferrer">npm</a>.
      </P>
      <Code
        tabs={[
          { label: 'ES modules', lang: 'js', code: SETUP },
          { label: 'CommonJS', lang: 'js', code: REQUIRE },
        ]}
      />
      <P>
        Use a test key while you build and a live key when you go live; the SDK talks to the same base URL either way. Keep the key on your server. See <Link to="/authentication">Authentication</Link>.
      </P>

      <H2>Make a checkout</H2>
      <P>Pass your order id as the idempotency key. If the request is retried, you get the same checkout back instead of a second one.</P>
      <Code tabs={[{ label: 'Node.js', lang: 'js', code: CHECKOUT }]} />

      <H2>Read checkouts and payments</H2>
      <Code tabs={[{ label: 'Node.js', lang: 'js', code: READ }]} />

      <H2>Lists</H2>
      <P>
        Every list method has an <C>each</C> twin that walks every page for you, so you can loop over all your payments without handling cursors.
      </P>
      <Code tabs={[{ label: 'Node.js', lang: 'js', code: PAGES }]} />

      <H2>Check webhook signatures</H2>
      <P>
        <C>webhooks.constructEvent</C> checks the <C>mm-signature</C> header against the raw body and your signing secret, refuses anything signed more than five minutes ago, and returns the event. Pass the body exactly as it arrived, before any JSON
        parsing.
      </P>
      <Code tabs={[{ label: 'Node.js', lang: 'js', code: WEBHOOK }]} />
      <Note type="tip">Testing your handler? <C>webhooks.sign(body, secret)</C> makes a valid header for a body of your own.</Note>

      <H2>Errors and retries</H2>
      <P>
        Any error from the API is a <C>MoneyMovesError</C> with its HTTP <C>status</C>, the <C>code</C> from <Link to="/errors">Errors</Link>, and the <C>requestId</C> to quote to support.
      </P>
      <UL>
        <li>Reads are retried twice on network errors, 429s and 5xx, with a short wait between tries.</li>
        <li>Writes are sent once. If a write gets no answer, you get a <C>MoneyMovesConnectionError</C> with <C>outcomeUnknown</C> set, so you can check before trying again.</li>
        <li>Give a write an idempotency key and it's retried like a read, because the API never does it twice.</li>
      </UL>
      <Code tabs={[{ label: 'Node.js', lang: 'js', code: ERRORS }]} />

      <H2>Everything it covers</H2>
      <Table
        head={['Resource', 'Methods']}
        rows={[
          [<C>account</C>, <C>retrieve</C>],
          [<C>checkouts</C>, <><C>create</C>, <C>retrieve</C>, <C>list</C>, <C>each</C>, <C>cancel</C></>],
          [<C>payments</C>, <><C>retrieve</C>, <C>list</C>, <C>each</C></>],
          [<C>settlements</C>, <><C>retrieve</C>, <C>list</C>, <C>each</C></>],
          [<C>refunds</C>, <><C>create</C>, <C>retrieve</C>, <C>list</C>, <C>each</C>, <C>cancel</C>, <C>simulate</C> (test keys)</>],
          [<C>disputes</C>, <><C>retrieve</C>, <C>list</C>, <C>each</C>, <C>reply</C>, <C>create</C> and <C>accept</C> (test keys)</>],
          [<C>balance</C>, <C>retrieve</C>],
          [<C>rates</C>, <C>retrieve</C>],
          [<C>events</C>, <><C>retrieve</C>, <C>list</C>, <C>each</C></>],
          [<C>webhooks</C>, <><C>constructEvent</C>, <C>sign</C></>],
        ]}
      />
      <H3>Options</H3>
      <P>
        <C>new MoneyMoves(key, {'{ timeoutMs, maxRetries, baseUrl, fetch }'})</C>. The defaults are a 30 second timeout and two retries. Pass your own <C>fetch</C> to use a proxy or to stub requests in tests.
      </P>

      <Next
        links={[
          ['/quickstart', 'Quickstart', 'take your first test payment.'],
          ['/webhooks', 'Webhooks', 'set up your endpoint.'],
          ['/api', 'API reference', 'every endpoint and field.'],
        ]}
      />
    </Page>
  )
}
