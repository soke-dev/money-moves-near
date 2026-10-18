import { Link } from 'react-router-dom'
import { Block, C, Code, H2, Next, Note, OL, P, Page, Step, Steps, Table, UL } from '@/components/docs'
import { EVENT, PAYMENT, REFUND, SETTLEMENT } from '@/components/api'
import { DASHBOARD_URL } from '@/nav'

/* ─── Overview ─────────────────────────────────────────────────────── */

export function WebhooksOverview() {
  return (
    <Page title="Webhooks" lead="Receive an event on your server when a payment succeeds, a settlement completes, or another supported event occurs.">
      <H2>Set one up</H2>
      <Steps>
        <Step title="Add an endpoint">
          <P>
            In the dashboard, open <a href={`${DASHBOARD_URL}/settings/webhooks`}>Developers → Webhooks</a> and add your server's HTTPS endpoint. Choose which events it should receive, or subscribe to all events. Test and live modes use separate endpoints and signing secrets.
          </P>
        </Step>
        <Step title="Respond within 10 seconds">
          <P>Return a 2xx response within 10 seconds. Queue the event or process it in the background so longer-running work doesn't delay your response.</P>
        </Step>
        <Step title="Check the signature">
          <P>
            Verify each event's signature before processing it. See <Link to="/webhooks/signatures">Verifying signatures</Link> for instructions.
          </P>
        </Step>
        <Step title="Send a test event">
          <P>Use the endpoint menu to send a test event. The dashboard shows your server's response here and under Events.</P>
        </Step>
      </Steps>

      <H2>What arrives</H2>
      <Block lang="http" label="Request" code={`POST /webhooks/money-moves HTTP/1.1
Content-Type: application/json
User-Agent: MoneyMoves-Webhooks/1.0
mm-event: payment.successful
mm-event-id: ${EVENT.id}
mm-signature: t=1792271452,v1=5f2c9e1b7d…a04d`} />
      <Code title="Body" tabs={[{ label: 'JSON', lang: 'json', code: JSON.stringify(EVENT, null, 2) }]} />
      <P>
        <C>data.object</C> contains a snapshot of the related object at the time the event was created, in the same format used by the API. <C>mode</C> indicates whether the event is from test or live mode.
      </P>

      <H2>A handler</H2>
      <Code
        tabs={[
          {
            label: 'Node.js',
            lang: 'js',
            code: `import express from "express";
import crypto from "crypto";

const app = express();

// Keep the raw body: the signature is over the exact bytes we sent.
app.post("/webhooks/money-moves", express.raw({ type: "application/json" }), (req, res) => {
  if (!verify(req.body, req.get("mm-signature"), process.env.MONEYMOVES_WEBHOOK_SECRET)) {
    return res.sendStatus(400);
  }
  const event = JSON.parse(req.body);
  res.sendStatus(200); // answer first, then do the work

  if (event.type === "payment.successful") {
    const payment = event.data.object;
    markOrderPaid(payment.checkout_reference, payment.reference);
  }
});

function verify(raw, header, secret) {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=")));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false; // older than 5 minutes
  const expected = crypto.createHmac("sha256", secret).update(\`\${parts.t}.\${raw}\`).digest("hex");
  return expected.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}`,
          },
          {
            label: 'Python',
            lang: 'python',
            code: `import hashlib, hmac, json, os, time
from flask import Flask, request

app = Flask(__name__)

@app.post("/webhooks/money-moves")
def money_moves():
    raw = request.get_data()  # the exact bytes we sent
    if not verify(raw, request.headers.get("mm-signature", ""), os.environ["MONEYMOVES_WEBHOOK_SECRET"]):
        return "", 400
    event = json.loads(raw)
    if event["type"] == "payment.successful":
        payment = event["data"]["object"]
        mark_order_paid(payment["checkout_reference"], payment["reference"])
    return "", 200

def verify(raw, header, secret):
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    if "t" not in parts or "v1" not in parts:
        return False
    if abs(time.time() - int(parts["t"])) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])`,
          },
        ]}
      />
      <Note type="tip" title="Handle each event once">
        The same event may be delivered more than once, for example after a retry or when you resend it from the dashboard. Store the <C>id</C> of each processed event and ignore IDs you've already handled.
      </Note>

      <H2>Where you can send</H2>
      <UL>
        <li>Endpoints must use HTTPS and a public address. Private, internal and loopback addresses are rejected when you save the endpoint and before every delivery.</li>
        <li>Redirects aren't followed. Enter the endpoint's final URL.</li>
        <li>For local testing, use a tunnel such as ngrok to expose a public HTTPS URL.</li>
      </UL>
      <Next
        links={[
          ['/webhooks/events', 'Event types', 'Every event we send, with an example.'],
          ['/webhooks/signatures', 'Verifying signatures', 'Prove an event came from us.'],
          ['/webhooks/retries', 'Retries and delivery', 'What happens when your server is down.'],
        ]}
      />
    </Page>
  )
}

/* ─── Event types ──────────────────────────────────────────────────── */

const ev = (type: string, object: unknown) => JSON.stringify({ ...EVENT, type, data: { object } }, null, 2)

export function WebhookEvents() {
  return (
    <Page title="Event types" lead="Each event includes the related object in the same format returned by the API.">
      <Table
        head={['Event', 'When', 'Object']}
        rows={[
          [<C>payment.successful</C>, 'The full amount was received. Fulfil the order.', <Link to="/api/payments">payment</Link>],
          [<C>payment.underpaid</C>, 'The amount received is less than the amount due. Funds are held, not settled. Request the remainder or issue a refund.', <Link to="/api/payments">payment</Link>],
          [<C>payment.expired</C>, 'The payment expired without receiving funds.', <Link to="/api/payments">payment</Link>],
          [<C>invoice.paid</C>, 'An invoice was paid in full.', 'invoice'],
          [<C>settlement.completed</C>, 'The settlement reached its destination.', <Link to="/api/settlements">settlement</Link>],
          [<C>refund.created</C>, 'A refund was created in the dashboard or through the API.', <Link to="/api/refunds">refund</Link>],
          [<C>refund.completed</C>, 'The refund was sent to the customer.', <Link to="/api/refunds">refund</Link>],
          [<C>dispute.created</C>, 'A customer raised a dispute from their receipt, or we recorded a bank claim on a bank transfer.', <Link to="/api/disputes">dispute</Link>],
          [<C>dispute.updated</C>, 'You replied to a dispute, from the dashboard or the API.', <Link to="/api/disputes">dispute</Link>],
          [<C>dispute.closed</C>, 'A dispute closed: in your favour, with a refund, or against you.', <Link to="/api/disputes">dispute</Link>],
          [<C>payout.completed</C>, 'A transfer from your business wallet completed. Live mode only.', 'payout'],
          [<C>payout.failed</C>, 'A transfer from your business wallet failed. Live mode only.', 'payout'],
        ]}
      />
      <P>
        <C>webhook.test</C> is sent when you use the dashboard's test button. It isn't retried or included in the <Link to="/api/events">Events API</Link>.
      </P>
      <H2 id="payment">payment.successful</H2>
      <Code title="Body" tabs={[{ label: 'JSON', lang: 'json', code: ev('payment.successful', PAYMENT) }]} />
      <H2 id="settlement">settlement.completed</H2>
      <Code title="Body" tabs={[{ label: 'JSON', lang: 'json', code: ev('settlement.completed', SETTLEMENT) }]} />
      <H2 id="refund">refund.created</H2>
      <Code title="Body" tabs={[{ label: 'JSON', lang: 'json', code: ev('refund.created', REFUND) }]} />
      <H2 id="invoice">invoice.paid</H2>
      <Code
        title="Body"
        tabs={[
          {
            label: 'JSON',
            lang: 'json',
            code: ev('invoice.paid', { id: 'cmvd4b1k0000amk30c9t2xq7f', object: 'invoice', mode: 'live', number: 'INV-0042', status: 'paid', amount: 25000, currency: 'NGN', customer: { email: 'ada@example.com', name: 'Ada Okafor' }, url: 'https://pay.usemoneymoves.xyz/i/k2Q9pXa0LrT9', due_at: '2026-10-24T00:00:00.000Z', paid_at: '2026-10-17T19:02:00.000Z', created_at: '2026-10-17T18:00:00.000Z' }),
          },
        ]}
      />
      <H2 id="payout">payout.completed</H2>
      <Code
        title="Body"
        tabs={[
          {
            label: 'JSON',
            lang: 'json',
            code: ev('payout.completed', { id: 'cmvd5c2m0000bmk30d1u3yr8g', object: 'payout', status: 'completed', reference: 'PO-4H8K2M', destination: 'bank', network: 'Movement', amount_usdc: 50, bank: { name: 'Opay', account_number: '8161859340', account_name: 'MOVERS TECH LTD', amount_ngn: 67814, fee_ngn: 100 }, address: null, transaction: '0x9c41…e2a7', created_at: '2026-10-17T19:10:00.000Z' }),
          },
        ]}
      />
    </Page>
  )
}

/* ─── Signatures ───────────────────────────────────────────────────── */

export function WebhookSignatures() {
  return (
    <Page title="Verifying signatures" lead="Verify the signature on each webhook to confirm it came from Money Moves and wasn't altered in transit.">
      <H2>The header</H2>
      <Block lang="text" label="mm-signature" code="t=1792271452,v1=5f2c9e1b7d3a8c40f1e6b2d9a7c5e3f1b8d6a4c2e0f9b7d5a3c1e8f6b4d2a04d" />
      <UL>
        <li>
          <C>t</C> is the signing time as a Unix timestamp in seconds.
        </li>
        <li>
          <C>v1</C> is the hexadecimal HMAC-SHA256 signature of <C>{'{t}.{raw body}'}</C>, generated with your signing secret.
        </li>
      </UL>
      <H2>Check it</H2>
      <OL>
        <li>Read the raw request body before parsing it as JSON. The signature must be calculated from the exact bytes received.</li>
        <li>
          Parse the header to extract <C>t</C> and <C>v1</C>.</li>
        <li>
          Use your secret to compute the HMAC-SHA256 of <C>t</C>, a period, and the raw request body.
        </li>
        <li>Compare the computed signature with <C>v1</C> using a constant-time comparison.</li>
        <li>Reject signatures with timestamps more than five minutes old to reduce the risk of replay attacks.</li>
      </OL>
      <P>
        See the <Link to="/webhooks">webhook overview</Link> for Node.js and Python examples.
      </P>
      <H2>Your secret</H2>
      <UL>
        <li>
          Signing secrets start with <C>whsec_</C>. Find them under <a href={`${DASHBOARD_URL}/settings/webhooks`}>Developers → Webhooks</a>. Test and live modes have separate secrets.
        </li>
        <li>Store the secret on your server, just like your API key.</li>
        <li>You can generate a new secret from the same page. The old secret stops working immediately, so update your server when you rotate it.</li>
      </UL>
    </Page>
  )
}

/* ─── Retries ──────────────────────────────────────────────────────── */

export function WebhookRetries() {
  return (
    <Page title="Retries and delivery" lead="If your endpoint doesn't respond successfully, we retry delivery for up to about a day. Payment processing doesn't depend on webhook delivery.">
      <H2>When we try again</H2>
      <P>A delivery succeeds when your server returns a 2xx response within 10 seconds. We retry after any other response, including a 4xx or 5xx, a timeout or a connection failure:</P>
      <Table
        head={['Try', 'After the one before']}
        rows={[
          ['1', 'Straight away'],
          ['2', '5 minutes'],
          ['3', '30 minutes'],
          ['4', '2 hours'],
          ['5', '6 hours'],
          ['6', '16 hours'],
        ]}
      />
      <P>After the sixth attempt, the delivery is marked as failed. You can disable retries under Developers → Webhooks; if you do, a failed delivery won't be sent again automatically.</P>
      <H2>Staying correct</H2>
      <UL>
        <li>
          Events may be delivered more than once and can arrive out of order. Store each event's <C>id</C> and ignore events you've already processed.
        </li>
        <li>
          Before fulfilling an order, retrieve the payment with <Link to="/api/payments#retrieve">Retrieve a payment</Link> to confirm its status.
        </li>
        <li>
          If your endpoint was unavailable for longer, use the <Link to="/api/events">Events API</Link> to retrieve missed events. Events are retained for 30 days.
        </li>
      </UL>
      <H2>When an endpoint keeps failing</H2>
      <P>
        If every delivery to one of your endpoints fails for 24 hours, we email your account's owner and admins. The email names the endpoint, says when it started failing, and gives the date we'll turn it off. If it's still failing after 72 hours, and at
        least 48 hours after that email, we turn the endpoint off and email you again. One successful delivery resets the count, and test events don't count either way.
      </P>
      <P>
        Turning an endpoint off never touches your payments: they settle as usual and every event is still recorded. When your server is fixed, open the endpoint under Developer portal → Webhooks and turn it back on. Events from while it was off aren't
        sent on their own, so send again the ones you need from the Events tab, or read them with the <Link to="/api/events">Events API</Link>.
      </P>
      <H2>Seeing what happened</H2>
      <P>
        Open <a href={`${DASHBOARD_URL}/settings/events`}>Developers → Events</a> to inspect each delivery, including its request body, your server's response and response time. After fixing your endpoint, resend a delivery from this page.
      </P>
      <P>
        Disabled or deleted endpoints don't receive new events, and pending deliveries to them are stopped.
      </P>
    </Page>
  )
}
