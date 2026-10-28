import { Link } from 'react-router-dom'
import { Block, C, Code, Endpoint, H2, Method, Note, P, Page, Params, Table, UL } from '@/components/docs'
import { CHECKOUT, EVENT, PAYMENT, REFUND, Request, Response, SETTLEMENT, list } from '@/components/api'
import { API_BASE } from '@/nav'

const PAGING = [
  { name: 'limit', type: 'integer', children: '1 to 100. Default 20.' },
  { name: 'starting_after', type: 'string', children: <>The last <C>id</C> of the page before, from <C>next_cursor</C>.</> },
  { name: 'created_after', type: 'timestamp', children: 'Return items created after this time.' },
  { name: 'created_before', type: 'timestamp', children: 'Return items created before this time.' },
]

/* ─── Overview ─────────────────────────────────────────────────────── */

export function ApiOverview() {
  return (
    <Page title="Introduction" lead="The Money Moves API: your first request, and the rules every endpoint follows.">
      <P>
        Use the API from your server to create checkouts, retrieve payments and settlements, issue refunds, check your balance and retrieve events. The REST API uses resource-based URLs, accepts and returns JSON, and uses standard HTTP status codes. API activity is also recorded in your dashboard.
      </P>
      <H2>Your first request</H2>
      <P>
        Include your secret key in the <C>Authorization</C> header of each request. Test and live requests use the same base URL; the key determines which mode the request accesses. Use this request to check a key:
      </P>
      <Code
        tabs={[
          { label: 'Test', lang: 'bash', code: `curl ${API_BASE}/account \\\n  -H "Authorization: Bearer $MONEYMOVES_TEST_KEY"` },
          { label: 'Live', lang: 'bash', code: `curl ${API_BASE}/account \\\n  -H "Authorization: Bearer $MONEYMOVES_LIVE_KEY"` },
        ]}
      />
      <P>
        Use an <C>sk_test_…</C> key while developing. After your business is verified, use an <C>sk_live_…</C> key for real payments. See <Link to="/authentication">Authentication</Link> to manage keys and <Link to="/test-mode">Test mode</Link> for details about simulated requests.
      </P>
      <H2>Base URL</H2>
      <Block lang="text" label="Base URL" code={API_BASE} />
      <H2>Conventions</H2>
      <Table
        head={['', '']}
        rows={[
          ['Format', <>JSON bodies with <C>Content-Type: application/json</C>, 100 KB at most. Responses are JSON too.</>],
          ['Amounts', <>Numbers use the currency's major unit: <C>5000</C> means ₦5,000 and <C>3.68</C> means $3.68. Do not send amounts in kobo or cents.</>],
          ['Currencies', <><C>NGN</C> and <C>USD</C>.</>],
          ['Times', <>ISO 8601 in UTC: <C>2026-10-17T17:40:51.000Z</C>.</>],
          ['Empty values', <>Empty fields are returned as <C>null</C>, rather than omitted.</>],
          ['References', <>Every payment has a <C>reference</C>, such as <C>MMB-9DQMDUNU</C>. Retrieve a payment, settlement or refund by its ID or reference.</>],
          ['Retries', <>Send an <C>Idempotency-Key</C> on a POST. See <Link to="/idempotency">Idempotency</Link>.</>],
          ['Lists', <>List results are newest first. Use <C>limit</C> and <C>starting_after</C> to paginate; responses include <C>has_more</C> and <C>next_cursor</C>.</>],
          ['Metadata', <>Add up to 20 of your own keys to a checkout using <C>metadata</C>. They are returned on the checkout, its payment and related events.</>],
          ['Request id', <>Every response includes an <C>mm-request-id</C> header. The same ID appears in your dashboard Logs.</>],
        ]}
      />
      <H2>Endpoints</H2>
      <Table
        head={['', 'Endpoint', '']}
        rows={[
          [<Method m="GET" />, <C>/v1/account</C>, <Link to="/api/account">Whose key this is</Link>],
          [<Method m="POST" />, <C>/v1/checkouts</C>, <Link to="/api/checkouts#create">Create a checkout</Link>],
          [<Method m="GET" />, <C>/v1/checkouts</C>, <Link to="/api/checkouts#list">List checkouts</Link>],
          [<Method m="GET" />, <C>/v1/checkouts/:id</C>, <Link to="/api/checkouts#retrieve">Retrieve a checkout</Link>],
          [<Method m="POST" />, <C>/v1/checkouts/:id/cancel</C>, <Link to="/api/checkouts#cancel">Cancel a checkout</Link>],
          [<Method m="GET" />, <C>/v1/payments</C>, <Link to="/api/payments#list">List payments</Link>],
          [<Method m="GET" />, <C>/v1/payments/:id</C>, <Link to="/api/payments#retrieve">Retrieve a payment</Link>],
          [<Method m="GET" />, <C>/v1/settlements</C>, <Link to="/api/settlements">List settlements</Link>],
          [<Method m="POST" />, <C>/v1/refunds</C>, <Link to="/api/refunds#create">Create a refund</Link>],
          [<Method m="GET" />, <C>/v1/refunds</C>, <Link to="/api/refunds#list">List refunds</Link>],
          [<Method m="GET" />, <C>/v1/balance</C>, <Link to="/api/balance">Get your balance</Link>],
          [<Method m="GET" />, <C>/v1/rates</C>, <Link to="/api/rates">Get today's rate</Link>],
          [<Method m="GET" />, <C>/v1/events</C>, <Link to="/api/events">List events</Link>],
        ]}
      />
      <H2>Status codes</H2>
      <Table
        head={['Status', 'Means']}
        rows={[
          ['200, 201', 'The request succeeded. 201 indicates that a resource was created.'],
          ['400', 'The request is invalid, for example because a field is missing, a value is invalid or an amount is outside your limits.'],
          ['401', 'The request has no API key, or the key is invalid.'],
          ['403', 'The request is not permitted, for example because it came from a browser, or the business is unverified.'],
          ['404', "The object doesn't exist in this key's mode, or the endpoint doesn't exist."],
          ['409', 'The request conflicts with the resource state, for example because it is already paid or a refund is pending.'],
          ['422', 'The Idempotency-Key was previously used with a different request body.'],
          ['429', 'The request rate limit was exceeded.'],
          ['5xx', 'A server error occurred. Retry using the same Idempotency-Key.'],
        ]}
      />
      <H2>Versioning</H2>
      <P>
        The current API version is 1, under <C>/v1</C>. We may add endpoints, optional request fields, response fields and event types without changing existing behavior. Make your integration tolerant of fields it doesn't recognize. Breaking changes will use a new API version, announced well in advance.
      </P>
      <H2>Errors</H2>
      <Response status={400} data={{ error: { code: 'invalid_request', message: 'currency: Invalid enum value. Expected \'NGN\' | \'USD\', received \'EUR\'', request_id: 'req_8kQ2mXa0LrT9vYc1' } }} />
      <P>
        See <Link to="/errors">Errors</Link> for the full list of error codes and recommended actions.
      </P>
    </Page>
  )
}

/* ─── Account ──────────────────────────────────────────────────────── */

export function ApiAccount() {
  return (
    <Page title="Account" lead="Identify the business and mode associated with your API key, and confirm that the key works.">
      <Endpoint id="retrieve" title="Retrieve the account" method="GET" path="/v1/account">
        <Request method="GET" path="/account" />
        <Response data={{ object: 'account', merchant_id: 'MM-7Q2K9P', name: 'Movers Tech LTD', mode: 'test', verified: true, key: { name: 'My shop server', prefix: 'sk_test_A1b2C3' } }} />
      </Endpoint>
    </Page>
  )
}

/* ─── Checkouts ────────────────────────────────────────────────────── */

export function ApiCheckouts() {
  return (
    <Page title="Checkouts" lead="Create a checkout for one order, direct the customer to its hosted payment page, then receive payment updates by webhook.">
      <H2 id="object">The checkout object</H2>
      <Params
        title="Fields"
        params={[
          { name: 'id', type: 'string', children: 'The checkout ID.' },
          { name: 'mode', type: 'enum', children: 'The mode selected by the API key that created the checkout.', values: ['test', 'live'] },
          { name: 'status', type: 'enum', children: 'The checkout status.', values: ['open', 'paid', 'expired', 'cancelled'] },
          { name: 'url', type: 'string', children: 'The hosted payment page URL.' },
          { name: 'amount', type: 'number', children: 'The price in the specified currency.' },
          { name: 'currency', type: 'enum', children: 'The currency used to set the price.', values: ['NGN', 'USD'] },
          { name: 'description', type: 'string | null', children: 'A description displayed on the payment page.' },
          { name: 'reference', type: 'string | null', children: 'Your reference, such as an order number.' },
          { name: 'metadata', type: 'object | null', children: 'Custom key-value data that you supplied.' },
          { name: 'methods', type: 'array', children: 'The payment methods available to the customer.', values: ['bank_transfer', 'app', 'crypto'] },
          { name: 'customer', type: 'object', children: <><C>email</C> and <C>name</C>, filled in for the customer on the page.</> },
          { name: 'fee_payer', type: 'enum | null', children: 'Who pays the processing fee on this checkout, whichever way the customer pays. If null, each way to pay follows your account setting.', values: ['business', 'customer'] },
          { name: 'redirect_url', type: 'string | null', children: 'The URL customers are sent to after payment.' },
          { name: 'payment', type: 'object | null', children: <>The associated <Link to="/api/payments">payment</Link>, once paid.</> },
          { name: 'expires_at', type: 'timestamp | null', children: 'When the checkout expires. Null means it has no expiry.' },
          { name: 'created_at', type: 'timestamp', children: 'When the checkout was created.' },
        ]}
      />

      <Endpoint id="create" title="Create a checkout" method="POST" path="/v1/checkouts">
        <P>
          Creates a checkout for an order. Unknown fields are rejected, so a typo such as <C>ammount</C> returns an error instead of being ignored. Send your order ID as the <C>Idempotency-Key</C> to prevent retries from creating duplicate checkouts.
        </P>
        <UL>
          <li>In test mode, all payment methods are available unless you specify <C>methods</C>. In live mode, only methods enabled for your account are available.</li>
          <li>If you provide the customer's name and email, the checkout page pre-fills those fields.</li>
          <li>Prices in USD are also shown in local currency at the current rate. The rate is fixed when the payment opens.</li>
        </UL>
        <Params
          params={[
            { name: 'amount', type: 'number', required: true, children: <>The price in <C>currency</C>. Must be within your account's limits: ₦100 to ₦1,000,000 for a registered business, or at least $1 for USD.</> },
            { name: 'currency', type: 'enum', required: true, children: 'The currency used to set the price.', values: ['NGN', 'USD'] },
            { name: 'description', type: 'string', children: 'A description displayed on the payment page. Up to 200 characters.' },
            { name: 'reference', type: 'string', children: 'Your reference, returned on the payment and related events. Up to 100 characters.' },
            { name: 'methods', type: 'array', children: 'Payment methods to offer. If omitted, all methods enabled for your account are available.', values: ['bank_transfer', 'app', 'crypto'] },
            { name: 'accept', type: 'object', children: <>For crypto, specify accepted coins and networks, such as <C>{'{"USDC": ["Solana", "Base"]}'}</C>. If omitted, all enabled combinations are accepted.</> },
            { name: 'customer', type: 'object', children: <><C>email</C> and <C>name</C>. Filled in for them on the page, and the email gets the receipt.</> },
            { name: 'metadata', type: 'object', children: 'Up to 20 custom keys, each up to 40 characters. Values can be strings (up to 500 characters), numbers or booleans.' },
            { name: 'expires_in', type: 'integer', children: <>Seconds until the checkout expires: 300 to 2,592,000 (30 days). Use <C>expires_at</C> with an ISO timestamp instead.</> },
            { name: 'fee_payer', type: 'enum', children: <>Who pays the processing fee on this checkout, whichever way the customer pays. If omitted, bank transfer and crypto each follow your account setting. See <Link to="/fees">Fees</Link>.</>, values: ['business', 'customer'] },
            { name: 'settle_to', type: 'enum', children: <>The settlement destination. If omitted, funds go where you chose for API payments in the dashboard, or on Automatic to a verified bank account, then a linked Money Moves account, then your business wallet. See <Link to="/settlement">Settlement</Link>.</>, values: ['bank', 'money_moves', 'wallet'] },
            { name: 'redirect_url', type: 'string', children: 'An HTTPS URL where the customer is sent after payment.' },
          ]}
        />
        <Request
          method="POST"
          path="/checkouts"
          idempotent
          body={{ amount: 5000, currency: 'NGN', description: 'Two shirts', reference: 'order_1042', customer: { email: 'ada@example.com', name: 'Ada Okafor' }, metadata: { order_id: '1042' }, expires_in: 7200, redirect_url: 'https://yourshop.com/orders/1042/thanks' }}
        />
        <Response status={201} data={CHECKOUT} />
      </Endpoint>

      <Endpoint id="retrieve" title="Retrieve a checkout" method="GET" path="/v1/checkouts/:id">
        <P>
          When the checkout is paid, <C>status</C> is <C>paid</C> and <C>payment</C> contains the payment details, including its reference, method and receipt URL. Retrieve the checkout as a fallback if your order page needs to confirm payment before a webhook arrives.
        </P>
        <Request method="GET" path={`/checkouts/${CHECKOUT.id}`} />
        <Response data={{ ...CHECKOUT, status: 'paid', payment: PAYMENT }} />
      </Endpoint>

      <Endpoint id="list" title="List checkouts" method="GET" path="/v1/checkouts">
        <P>Returns API-created checkouts, newest first. Payment links created in the dashboard aren't included.</P>
        <Params title="Query parameters" params={[{ name: 'reference', type: 'string', children: 'Only checkouts with this reference.' }, ...PAGING]} />
        <Request method="GET" path="/checkouts?limit=20&reference=order_1042" />
        <Response data={list(CHECKOUT)} />
      </Endpoint>

      <Endpoint id="cancel" title="Cancel a checkout" method="POST" path="/v1/checkouts/:id/cancel">
        <P>Stops the checkout from accepting new payment attempts. A customer who has already started a transfer may still complete it, and that payment will count. You can't cancel a paid checkout; issue a refund instead.</P>
        <Request method="POST" path={`/checkouts/${CHECKOUT.id}/cancel`} />
        <Response data={{ ...CHECKOUT, status: 'cancelled' }} />
      </Endpoint>
    </Page>
  )
}

/* ─── Payments ─────────────────────────────────────────────────────── */

export function ApiPayments() {
  return (
    <Page title="Payments" lead="A payment is one customer paying, by one method. It comes from an API checkout, a payment link, an invoice or a store QR.">
      <H2 id="object">The payment object</H2>
      <Params
        title="Fields"
        params={[
          { name: 'id · reference', type: 'string', children: <>The payment ID and its customer-facing reference, such as <C>MMB-9DQMDUNU</C>, shown on the receipt.</> },
          { name: 'status', type: 'enum', children: <>The <Link to="/statuses">payment status</Link>.</>, values: ['open', 'successful', 'underpaid', 'expired'] },
          { name: 'checkout · invoice · outlet', type: 'string | null', children: 'The checkout or payment link, invoice, or store QR associated with the payment.' },
          { name: 'checkout_reference · metadata', type: 'string | object | null', children: 'The reference and metadata supplied with the checkout.' },
          { name: 'currency', type: 'enum', children: 'The currency used to price the payment.', values: ['NGN', 'USD'] },
          { name: 'amount_ngn · amount_usd', type: 'number', children: 'The amount due in both currencies, using the rate fixed when the payment opened.' },
          { name: 'received_ngn', type: 'number | null', children: 'The amount received in NGN. Null until funds arrive.' },
          { name: 'fee_ngn', type: 'number | null', children: <>The fee charged for this payment. See <Link to="/fees">Fees</Link>.</> },
          { name: 'customer_fee_ngn', type: 'number | null', children: 'The fee charged to the customer, if applicable.' },
          { name: 'rate_ngn_per_usd', type: 'number', children: 'The exchange rate fixed for this payment.' },
          { name: 'method', type: 'enum', children: 'The method used to pay.', values: ['bank_transfer', 'app', 'crypto'] },
          { name: 'crypto', type: 'object | null', children: <>For crypto: <C>coin</C>, <C>network</C>, the <C>address</C> it was paid to, a <C>memo</C> on Stellar and TON, and the <C>transaction</C>.</> },
          { name: 'customer', type: 'object', children: <><C>email</C>, <C>name</C> and <C>phone</C> provided by the customer.</> },
          { name: 'payer', type: 'object | null', children: 'Payer details, when available: name, bank and account for transfers, or the sending wallet for crypto.' },
          { name: 'receipt_url', type: 'string | null', children: "The customer's receipt URL, once the payment succeeds." },
          { name: 'created_at · paid_at · expires_at', type: 'timestamp', children: 'When the payment opened, when it was paid, and when it expires if unpaid.' },
        ]}
      />
      <Endpoint id="retrieve" title="Retrieve a payment" method="GET" path="/v1/payments/:id">
        <P>Retrieve a payment by its ID or its reference, such as <C>MMB-9DQMDUNU</C>. The reference appears on the customer's receipt and can help support identify the payment.</P>
        <Request method="GET" path="/payments/MMB-9DQMDUNU" />
        <Response data={PAYMENT} />
      </Endpoint>
      <Endpoint id="list" title="List payments" method="GET" path="/v1/payments">
        <P>
          Returns payments in the mode of your API key, including payments from API checkouts, payment links, invoices and store QRs. Expired payments are included. Use <C>status=successful</C> to return only successful payments.
        </P>
        <Params
          title="Query parameters"
          params={[
            { name: 'status', type: 'enum', children: 'Only payments in this state.', values: ['open', 'successful', 'underpaid', 'expired'] },
            { name: 'method', type: 'enum', children: 'Only payments made this way.', values: ['bank_transfer', 'app', 'crypto'] },
            { name: 'checkout', type: 'string', children: 'Only payments through this checkout.' },
            ...PAGING,
          ]}
        />
        <Request method="GET" path="/payments?status=successful&limit=20" />
        <Response data={list(PAYMENT)} />
      </Endpoint>
    </Page>
  )
}

/* ─── Settlements ──────────────────────────────────────────────────── */

export function ApiSettlements() {
  return (
    <Page title="Settlements" lead="Each successful payment has a settlement that sends the funds, minus fees, to your chosen destination: your bank in local currency or a wallet in USDC.">
      <H2 id="object">The settlement object</H2>
      <Params
        title="Fields"
        params={[
          { name: 'status', type: 'enum', children: <>A settlement is <C>pending</C> until it arrives. If a bank or network delays it, it stays pending while our team investigates.</>, values: ['pending', 'completed'] },
          { name: 'payment · payment_reference', type: 'string', children: 'The payment associated with this settlement.' },
          { name: 'destination', type: 'enum', children: 'The settlement destination.', values: ['bank', 'money_moves', 'wallet'] },
          { name: 'amount_ngn · fee_ngn', type: 'number', children: 'The settlement amount and the fee deducted.' },
          { name: 'bank', type: 'object | null', children: 'For bank settlements: the bank name, account number and account name.' },
          { name: 'crypto', type: 'object | null', children: <>For wallet settlements: the <C>network</C>, <C>address</C>, <C>amount_usdc</C> and transaction details.</> },
          { name: 'created_at · completed_at', type: 'timestamp', children: 'When the settlement was created and when it completed.' },
        ]}
      />
      <Endpoint id="list" title="List settlements" method="GET" path="/v1/settlements">
        <Params
          title="Query parameters"
          params={[{ name: 'status', type: 'enum', children: 'Return settlements with this status.', values: ['pending', 'completed'] }, { name: 'payment', type: 'string', children: 'Return the settlement for this payment.' }, ...PAGING]}
        />
        <Request method="GET" path="/settlements?status=completed" />
        <Response data={list(SETTLEMENT)} />
      </Endpoint>
      <Endpoint id="retrieve" title="Retrieve a settlement" method="GET" path="/v1/settlements/:id">
        <P>Retrieve a settlement by its ID or reference.</P>
        <Request method="GET" path={`/settlements/${SETTLEMENT.id}`} />
        <Response data={SETTLEMENT} />
      </Endpoint>
    </Page>
  )
}

/* ─── Refunds ──────────────────────────────────────────────────────── */

export function ApiRefunds() {
  return (
    <Page title="Refunds" lead="Return all or part of a payment to the customer using their original payment method. Fund the refund by transferring the requested amount to the account provided.">
      <H2 id="object">The refund object</H2>
      <Params
        title="Fields"
        params={[
          { name: 'status', type: 'enum', children: 'The refund state: awaiting funds, processing, completed or cancelled.', values: ['awaiting_funds', 'processing', 'completed', 'cancelled'] },
          { name: 'payment', type: 'string', children: 'The payment being refunded.' },
          { name: 'amount_ngn · amount_usd', type: 'number', children: 'The refund amount in NGN and USD.' },
          { name: 'funding', type: 'object', children: <>Funding details: <C>amount_ngn</C> (the amount to transfer after our refunded fee is deducted), <C>fee_returned_ngn</C>, and the destination <C>bank</C> account with its <C>expires_at</C>. For an underpaid payment that we haven't settled, <C>method</C> is <C>held</C> and no transfer is required.</> },
          { name: 'to', type: 'object', children: <>The refund destination. <C>kind</C> is <C>bank</C>, <C>app</C> or <C>wallet</C>, with the relevant account, coin and network details.</> },
          { name: 'reason', type: 'string | null', children: 'Your reason for issuing the refund.' },
        ]}
      />
      <Endpoint id="create" title="Create a refund" method="POST" path="/v1/refunds">
        <P>
          Specify the refund amount in the currency used for the original payment: NGN for local fiat, or USD for payments made through the app or with crypto. Omit <C>amount</C> to refund the remaining balance.
        </P>
        <Params
          params={[
            { name: 'payment', type: 'string', required: true, children: 'The ID or reference of a successful or underpaid payment.' },
            { name: 'amount', type: 'number', children: 'The amount to refund. If omitted, the remaining refundable amount is used.' },
            { name: 'reason', type: 'string', children: 'An optional note for your records. Up to 280 characters.' },
          ]}
        />
        <Request method="POST" path="/refunds" idempotent body={{ payment: 'MMB-9DQMDUNU', amount: 0.74, reason: 'One shirt back' }} />
        <Response status={201} data={REFUND} />
        <Note title="One at a time">Only one refund per payment can await funding at a time. Fund or cancel it before creating another refund for that payment.</Note>
      </Endpoint>
      <Endpoint id="retrieve" title="Retrieve a refund" method="GET" path="/v1/refunds/:id">
        <P>Retrieving a refund checks its funding account, so the status updates when your transfer arrives.</P>
        <Request method="GET" path={`/refunds/${REFUND.id}`} />
        <Response data={{ ...REFUND, status: 'processing', funding: { ...REFUND.funding, funded_at: '2026-10-17T18:43:10.000Z' } }} />
      </Endpoint>
      <Endpoint id="list" title="List refunds" method="GET" path="/v1/refunds">
        <Params
          title="Query parameters"
          params={[{ name: 'status', type: 'enum', children: 'Only refunds in this state.', values: ['awaiting_funds', 'processing', 'completed', 'cancelled'] }, { name: 'payment', type: 'string', children: 'Only refunds of this payment.' }, ...PAGING]}
        />
        <Request method="GET" path="/refunds?status=awaiting_funds" />
        <Response data={list(REFUND)} />
      </Endpoint>
      <Endpoint id="cancel" title="Cancel a refund" method="POST" path="/v1/refunds/:id/cancel">
        <P>You can cancel a refund only while it's awaiting funds.</P>
        <Request method="POST" path={`/refunds/${REFUND.id}/cancel`} />
        <Response data={{ ...REFUND, status: 'cancelled' }} />
      </Endpoint>
      <Endpoint id="simulate" title="Simulate your transfer (test)" method="POST" path="/v1/refunds/:id/simulate">
        <P>Test keys only. Simulate a transfer to the refund account to test the refund flow.</P>
        <Request method="POST" path={`/refunds/${REFUND.id}/simulate`} />
        <Response data={{ ...REFUND, mode: 'test', status: 'processing' }} />
      </Endpoint>
    </Page>
  )
}

/* ─── Disputes ─────────────────────────────────────────────────────── */

const DISPUTE = {
  id: 'cmve2k9x40007dsp8f1a2b3c4',
  object: 'dispute',
  mode: 'live',
  kind: 'customer',
  status: 'needs_reply',
  reference: 'MMBD-7K2Q9XHD',
  payment: 'cmve2h1q20003pay4d5e6f7g8',
  reason: 'not_received',
  amount_ngn: 45000,
  reply_by: '2026-10-21T17:41:00.000Z',
  customer_answers_by: null,
  outcome: null,
  refund: null,
  created_at: '2026-10-18T17:41:00.000Z',
  closed_at: null,
}
const MESSAGES = [
  { from: 'customer', body: 'I paid a week ago and the gown has not arrived.', files: [], created_at: '2026-10-18T17:41:00.000Z' },
  { from: 'money_moves', body: "We've told Ada Fashion House. They have until 21 Oct, 17:41 to reply or refund.", files: [], created_at: '2026-10-18T17:41:00.000Z' },
]

export function ApiDisputes() {
  return (
    <Page title="Disputes" lead="Read and answer disputes on your payments: customers who raise one from their receipt, and bank claims on bank transfers.">
      <P>
        A customer can dispute a payment from their receipt up to 60 days after paying. You have 3 days to reply or refund. After you reply, they have 3 days to accept or answer; if they don't, it closes in your favour. If you don't reply in time, it closes in the
        customer's favour. A refund on the payment closes an open dispute.
      </P>
      <P>
        A bank claim happens only on a bank transfer: the sender's bank says the transfer wasn't authorised and asks for the money back. Reply with proof of the sale within 5 days. We pass it to the bank and record its decision. If the bank keeps its claim, fund
        it the way you fund a refund. Attach files to a reply from the dashboard.
      </P>
      <H2 id="object">The dispute object</H2>
      <Params
        title="Fields"
        params={[
          { name: 'kind', type: 'enum', children: 'Raised by the customer, or a claim from the sender’s bank.', values: ['customer', 'bank_claim'] },
          { name: 'status', type: 'enum', children: <>Your turn while <C>needs_reply</C>; with the customer or the bank while <C>under_review</C>. Then closed: in your favour, with a refund, or against you.</>, values: ['needs_reply', 'under_review', 'won', 'refunded', 'lost'] },
          { name: 'reference', type: 'string', children: <>Starts with <C>MMBD-</C>. Use it or the id with every endpoint.</> },
          { name: 'payment', type: 'string', children: 'The payment in question.' },
          { name: 'reason', type: 'enum', children: 'Why it was raised.', values: ['not_received', 'duplicate', 'not_as_described', 'unrecognised', 'unauthorised'] },
          { name: 'amount_ngn', type: 'number', children: 'What’s in question: the whole payment from a customer, or what the bank claims.' },
          { name: 'reply_by', type: 'timestamp', children: <>Your deadline while it's <C>needs_reply</C>.</> },
          { name: 'customer_answers_by', type: 'timestamp | null', children: 'After you reply to a customer: when they have to answer by.' },
          { name: 'outcome', type: 'string | null', children: 'How it closed, in a sentence.' },
          { name: 'refund', type: 'string | null', children: 'The refund that settled it, or funded a bank claim that was lost.' },
          { name: 'messages', type: 'array', children: <>On a single dispute: the conversation, each with <C>from</C> (<C>customer</C>, <C>business</C>, <C>bank</C> or <C>money_moves</C>), <C>body</C>, the <C>files</C> you attached, and <C>created_at</C>.</> },
        ]}
      />
      <Endpoint id="list" title="List disputes" method="GET" path="/v1/disputes">
        <Params
          title="Query parameters"
          params={[
            { name: 'status', type: 'enum', children: 'Only disputes in this state.', values: ['needs_reply', 'under_review', 'won', 'refunded', 'lost'] },
            { name: 'kind', type: 'enum', children: 'Only this kind.', values: ['customer', 'bank_claim'] },
            { name: 'payment', type: 'string', children: 'Only disputes on this payment.' },
            ...PAGING,
          ]}
        />
        <Request method="GET" path="/disputes?status=needs_reply" />
        <Response data={list(DISPUTE)} />
      </Endpoint>
      <Endpoint id="retrieve" title="Retrieve a dispute" method="GET" path="/v1/disputes/:id">
        <P>Comes with the whole conversation in <C>messages</C>.</P>
        <Request method="GET" path={`/disputes/${DISPUTE.reference}`} />
        <Response data={{ ...DISPUTE, messages: MESSAGES }} />
      </Endpoint>
      <Endpoint id="reply" title="Reply to a dispute" method="POST" path="/v1/disputes/:id/reply">
        <P>
          A customer then has 3 days to accept or answer; a bank claim goes to the bank. You can reply while it's <C>needs_reply</C> or <C>under_review</C>.
        </P>
        <Params params={[{ name: 'message', type: 'string', required: true, children: 'Your reply. Up to 4,000 characters.' }]} />
        <Request method="POST" path={`/disputes/${DISPUTE.reference}/reply`} body={{ message: 'It was delivered on Monday. The courier has a photo of the signature.' }} />
        <Response
          data={{
            ...DISPUTE,
            status: 'under_review',
            customer_answers_by: '2026-10-21T18:02:00.000Z',
            messages: [...MESSAGES, { from: 'business', body: 'It was delivered on Monday. The courier has a photo of the signature.', files: [], created_at: '2026-10-18T18:02:00.000Z' }],
          }}
        />
      </Endpoint>
      <Endpoint id="create" title="Open a test dispute (test)" method="POST" path="/v1/disputes">
        <P>Test keys only. Opens a dispute on a paid test payment, as its customer would from the receipt, so you can test your handling and webhooks.</P>
        <Params
          params={[
            { name: 'payment', type: 'string', required: true, children: 'The ID or reference of a paid test payment.' },
            { name: 'reason', type: 'enum', children: <>Defaults to <C>not_received</C>.</>, values: ['not_received', 'duplicate', 'not_as_described'] },
            { name: 'message', type: 'string', required: true, children: 'What the customer says. At least 10 characters.' },
          ]}
        />
        <Request method="POST" path="/disputes" body={{ payment: 'MMB-9DQMDUNU', reason: 'not_received', message: 'The order never arrived.' }} />
        <Response status={201} data={{ ...DISPUTE, mode: 'test', messages: MESSAGES }} />
      </Endpoint>
      <Endpoint id="accept" title="Accept your reply (test)" method="POST" path="/v1/disputes/:id/accept">
        <P>Test keys only. The test customer accepts your reply, and the dispute closes in your favour.</P>
        <Request method="POST" path={`/disputes/${DISPUTE.reference}/accept`} />
        <Response data={{ ...DISPUTE, mode: 'test', status: 'won', outcome: 'Ada accepted your reply, so it closed in your favour.', closed_at: '2026-10-18T18:05:00.000Z' }} />
      </Endpoint>
    </Page>
  )
}

/* ─── Balance ──────────────────────────────────────────────────────── */

export function ApiBalance() {
  return (
    <Page title="Balance" lead="View settlements in progress and, in live mode, the funds held in your business wallet.">
      <Endpoint id="retrieve" title="Get your balance" method="GET" path="/v1/balance">
        <P>
          <C>wallet</C> is <C>null</C> in test mode and until your business wallet is created. Wallet holdings are read from the supported networks and may be cached for up to 15 seconds.
        </P>
        <Request method="GET" path="/balance" />
        <Response
          data={{
            object: 'balance',
            mode: 'live',
            settling: { amount_ngn: 4987.5, count: 1 },
            wallet: { holdings: [{ coin: 'USDC', network: 'Movement', amount: 120.5 }, { coin: 'USDC', network: 'Solana', amount: 14.2 }], total_usd: 134.7, total_ngn: 182960.32 },
            rate_ngn_per_usd: 1358.28,
            as_of: '2026-10-17T18:50:00.000Z',
          }}
        />
      </Endpoint>
    </Page>
  )
}

/* ─── Rates ────────────────────────────────────────────────────────── */

export function ApiRates() {
  return (
    <Page title="Rates" lead="Get the current exchange rate from USD to NGN. This rate is used to display converted prices on checkouts.">
      <Endpoint id="retrieve" title="Get today's rate" method="GET" path="/v1/rates">
        <P>The rate is refreshed every few minutes. If it isn't available, the API returns a 503 instead of a stale value.</P>
        <Request method="GET" path="/rates" />
        <Response data={{ object: 'rate', base: 'USD', quote: 'NGN', ngn_per_usd: 1358.28, as_of: '2026-10-17T18:50:00.000Z' }} />
      </Endpoint>
    </Page>
  )
}

/* ─── Events ───────────────────────────────────────────────────────── */

export function ApiEvents() {
  return (
    <Page title="Events" lead="Retrieve webhook events to inspect a delivery or catch up after your server was unavailable.">
      <P>
        When a payment, settlement, refund, invoice or payout changes, we record an event containing a snapshot of the object and send it to your webhook endpoints. The Events API lets you retrieve these events later. If your server was unavailable, list events created since your last successful processing time and handle any you missed.
      </P>
      <H2 id="object">The event object</H2>
      <Params
        title="Fields"
        params={[
          { name: 'id', type: 'string', children: <>Starts with <C>evt_</C> and matches the webhook's <C>mm-event-id</C> header. Use it to avoid processing an event more than once.</> },
          { name: 'type', type: 'string', children: <>The event name, such as <C>payment.successful</C>. See <Link to="/webhooks/events">Event types</Link>.</> },
          { name: 'mode', type: 'enum', children: 'The event mode.', values: ['test', 'live'] },
          { name: 'created_at', type: 'timestamp', children: 'When the event was created.' },
          { name: 'data.object', type: 'object', children: 'A snapshot of the related payment, settlement, refund, invoice or payout, in the same format returned by the API.' },
        ]}
      />
      <Endpoint id="list" title="List events" method="GET" path="/v1/events">
        <P>
          Events are retained for 30 days. Test events sent from the dashboard aren't included. See <Link to="/webhooks/events">Event types</Link> for the supported types.
        </P>
        <Params title="Query parameters" params={[{ name: 'type', type: 'string', children: <>Only this type, like <C>payment.successful</C>.</> }, ...PAGING]} />
        <Request method="GET" path="/events?type=payment.successful" />
        <Response data={list(EVENT)} />
      </Endpoint>
      <Endpoint id="retrieve" title="Retrieve an event" method="GET" path="/v1/events/:id">
        <P>Retrieve an event using the ID in the webhook's <C>mm-event-id</C> header.</P>
        <Request method="GET" path={`/events/${EVENT.id}`} />
        <Response data={EVENT} />
      </Endpoint>
    </Page>
  )
}
