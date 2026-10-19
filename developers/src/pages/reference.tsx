import { Block, C, H2, H3, P, Page, Table, UL } from '@/components/docs'

/* ─── Fees ─────────────────────────────────────────────────────────── */

export function Fees() {
  return (
    <Page title="Fees" lead="Fees are charged when a payment settles. There are no setup or monthly fees, and failed payments aren't charged.">
      <Table
        head={['', 'Fee']}
        rows={[
          ['Bank transfer', '0.25% of the payment, at most ₦1,000'],
          ['Crypto (USDC and USDT)', '0.25% of the payment, at most $1'],
          ['Money Moves app', 'Free'],
          ['Sending from your business wallet to your bank', '₦100 a send'],
          ['Sending to a Money Moves account or a crypto address', 'Free'],
          ['Refunds', 'Free, and our fee on the refunded part comes back to you'],
        ]}
      />
      <P>
        We calculate the fee for each payment and deduct it from the settlement. For example, a ₦20,000 bank payment has a ₦50 fee and settles ₦19,950. A ₦1,000,000 bank payment reaches the fee cap of ₦1,000.
      </P>

      <H2>Who pays the fee</H2>
      <P>
        By default, the business pays the fee, which is deducted from the settlement. You can instead charge the customer the fee on top of the listed price, so the business receives the full payment amount. Choose this for your business in settings, on an individual payment link, invoice or store QR, or for an API checkout with <C>fee_payer</C>.
      </P>
      <P>
        When the customer pays the fee, <C>customer_fee_ngn</C> shows the additional amount charged. <C>fee_ngn</C> shows our fee on each payment, and the settlement shows the amount deducted.
      </P>

      <H2>Fees on refunds</H2>
      <P>When you refund all or part of a payment, we return the fee charged on the refunded amount. As a result, you transfer less than the customer receives; the returned fee covers the difference.</P>
    </Page>
  )
}

/* ─── Statuses ─────────────────────────────────────────────────────── */

export function Statuses() {
  return (
    <Page title="Statuses" lead="Look up each checkout, payment, settlement and refund status, and see what action to take next.">
      <H2>Checkout</H2>
      <Table
        head={['Status', 'What it means']}
        rows={[
          [<C>open</C>, 'The checkout is still accepting payments.'],
          [<C>paid</C>, 'The checkout was paid in full. The payment object is included.'],
          [<C>expired</C>, 'The checkout expired without being paid.'],
          [<C>cancelled</C>, 'The checkout was cancelled before payment.'],
        ]}
      />
      <H2>Payment</H2>
      <Table
        head={['Status', 'What it means', 'What to do']}
        rows={[
          [<C>open</C>, 'Waiting for payment. Bank transfer and crypto payments remain open for 30 minutes.', 'Wait for payment or let the customer try again.'],
          [<C>successful</C>, 'The full amount was received and settlement has started.', 'Fulfil the order.'],
          [<C>underpaid</C>, 'The amount received is less than the amount due. Funds are held, not settled.', 'Request the remaining amount or issue a refund.'],
          [<C>expired</C>, 'The payment expired without receiving funds.', 'The customer can start a new payment from the same checkout.'],
        ]}
      />
      <H2>Settlement</H2>
      <Table
        head={['Status', 'What it means']}
        rows={[
          [<C>pending</C>, 'Funds are being sent to your chosen destination. If a bank or network delays the transfer, it remains pending while our team investigates.'],
          [<C>completed</C>, 'Funds reached the destination.'],
        ]}
      />
      <H2>Refund</H2>
      <Table
        head={['Status', 'What it means']}
        rows={[
          [<C>awaiting_funds</C>, 'Waiting for you to transfer funds to the refund account.'],
          [<C>processing</C>, 'Your funds arrived and the refund is being sent to the customer.'],
          [<C>completed</C>, 'The refund was sent to the customer.'],
          [<C>cancelled</C>, 'The refund was cancelled before it was funded.'],
        ]}
      />
      <H2>Payout</H2>
      <Table
        head={['Status', 'What it means']}
        rows={[
          [<C>pending</C>, "Prepared and awaiting the owner's approval."],
          [<C>processing</C>, 'Approved and sent; awaiting confirmation from the bank or network.'],
          [<C>completed</C>, 'The transfer arrived.'],
          [<C>failed</C>, 'The transfer failed. No funds left the wallet, or our team is investigating.'],
          [<C>cancelled</C>, 'Cancelled before the owner approved it.'],
        ]}
      />
    </Page>
  )
}

/* ─── Errors ───────────────────────────────────────────────────────── */

export function Errors() {
  return (
    <Page title="Errors" lead="Each error includes an HTTP status, a stable code for your integration, and a human-readable message.">
      <P>
        Successful requests return a 2xx status. Errors include a response body like the example below. The <C>code</C> is stable and safe to use in your logic. The human-readable <C>message</C> may change, so don't use it to determine how your integration responds.
      </P>
      <Block lang="json" label="Error" code={JSON.stringify({ error: { code: 'bad_amount', message: 'The amount has to be between ₦100.00 and ₦1,000,000.00.', request_id: 'req_8kQ2mXa0LrT9vYc1' } }, null, 2)} />
      <P>
        Keep the <C>request_id</C> when investigating a failed request. It matches the <C>mm-request-id</C> response header and the ID in dashboard Logs. Include it when you contact support.
      </P>

      <H2>Handling errors well</H2>
      <UL>
        <li>A 4xx means the request must be corrected. Retrying the same request without changes will fail again.</li>
        <li>
          A 429 means the rate limit was exceeded. Wait before retrying; the <C>RateLimit</C> headers indicate when you can try again.
        </li>
        <li>
          A 5xx means the server encountered an error. Retry the request with the same <C>Idempotency-Key</C> to avoid creating a duplicate resource.
        </li>
      </UL>

      <H2>Every code</H2>
      <Table
        head={['Status', 'Code', 'What it means and what to do']}
        rows={[
          ['400', <C>invalid_request</C>, 'A field is missing, the wrong type, or not a field at all. The message names it.'],
          ['400', <C>invalid_json</C>, "The body isn't valid JSON."],
          ['400', <C>bad_amount</C>, 'The amount is outside your account’s limits.'],
          ['400', <C>bad_expiry</C>, 'An expiry has to be 5 minutes to 30 days from now.'],
          ['400', <C>bad_idempotency_key</C>, 'An Idempotency-Key has to be 1 to 255 characters.'],
          ['400', <C>no_bank</C>, 'Add a checked bank account first, or settle the checkout somewhere else.'],
          ['400', <C>bank_unchecked</C>, 'That bank account is still being checked.'],
          ['400', <C>no_money_moves</C>, 'Link a Money Moves account first.'],
          ['400', <C>method_paused</C>, 'That way to pay is paused for now. Leave it out of methods.'],
          ['400', <C>method_unavailable</C>, 'That way to pay isn’t available in live mode yet.'],
          ['400', <C>destination_paused</C>, 'Settling there is paused for now. Choose another place.'],
          ['400', <C>no_coins</C>, 'Pick at least one coin and network for crypto, or leave crypto out.'],
          ['400', <C>not_refundable</C>, 'Only a successful or underpaid payment can be refunded.'],
          ['400', <C>fully_refunded</C>, 'This payment has been refunded in full.'],
          ['400', <C>too_much</C>, "That's more than what's left to refund."],
          ['400', <C>test_only</C>, 'This only works with a test key.'],
          ['401', <C>no_key</C>, <>Send <C>Authorization: Bearer sk_…</C>.</>],
          ['401', <C>bad_key</C>, 'The key is unknown or revoked.'],
          ['403', <C>browser_not_allowed</C>, 'Call the API from your server, not a browser or an app.'],
          ['403', <C>business_unverified</C>, 'Live keys work once your business is verified.'],
          ['403', <C>business_suspended</C>, 'This business has been deactivated.'],
          ['404', <C>not_found</C>, "There's no such object in this key's mode, or no such endpoint."],
          ['409', <C>already_paid</C>, "It's paid already. Refund the payment instead."],
          ['409', <C>refund_waiting</C>, 'A refund on this payment is waiting for your money. Fund it or cancel it first.'],
          ['409', <C>not_cancellable</C>, 'Only a refund still waiting for your money can be cancelled.'],
          ['409', <C>wallet_not_created</C>, 'Create your business wallet first.'],
          ['409', <C>idempotency_in_progress</C>, 'The first request with this key is still running. Try again in a moment.'],
          ['422', <C>idempotency_key_reused</C>, 'This key was used with a different body. Use a new key for a new request.'],
          ['429', <C>rate_limited</C>, 'Too many requests. Slow down and retry.'],
          ['502', <C>account_failed</C>, "We couldn't open an account for a refund. Try again shortly."],
          ['503', <C>channel_paused</C>, 'The API is paused for maintenance. Try again shortly.'],
          ['503', <C>methods_paused</C>, 'No way to pay is switched on right now.'],
          ['503', <C>rate_unavailable</C>, "Today's rate can't be read right now. Try again in a minute."],
          ['500', <C>server_error</C>, 'Our fault. Retry with the same Idempotency-Key.'],
        ]}
      />
    </Page>
  )
}

/* ─── Idempotency and limits ───────────────────────────────────────── */

export function Idempotency() {
  return (
    <Page title="Idempotency and limits" lead="Retry a request without doing it twice, page through long lists, and stay inside the rate limits.">
      <H2>Idempotency keys</H2>
      <P>
        A network timeout can leave you unsure whether a request succeeded. An idempotency key lets you retry safely: send the same key again to receive the original response instead of creating a duplicate checkout.
      </P>
      <P>
        Include an <C>Idempotency-Key</C> header on POST requests. Use a value unique to the operation, such as a UUID or your order ID. Repeating the same key with the same request body returns the original response with an <C>idempotent-replayed: true</C>{' '}
        header.
      </P>
      <Block lang="http" label="Request" code={`POST /api/v1/checkouts HTTP/1.1
Authorization: Bearer sk_test_…
Idempotency-Key: order_1042
Content-Type: application/json`} />
      <H3>The rules</H3>
      <UL>
        <li>Answers are kept for 24 hours. After that, a key can be used again.</li>
        <li>
          The same key with a different body is refused with <C>idempotency_key_reused</C>, so a bug in your code can't quietly turn one order into another.
        </li>
        <li>
          If the first request is still running when the second arrives, the second gets <C>idempotency_in_progress</C>. Wait a moment and retry.
        </li>
        <li>A failure on our side (a 5xx) isn't kept, so retrying with the same key gets a fresh try.</li>
        <li>Keys belong to the API key that sent them. Two of your servers with different API keys can't collide.</li>
      </UL>

      <H2>Pagination</H2>
      <P>
        Lists return the newest items first, 20 by default and up to 100 when you set <C>limit</C>. If more results are available, <C>has_more</C> is true. Make the next request with <C>starting_after</C> set to <C>next_cursor</C>, the ID of the last item returned. Filter by time with <C>created_after</C> and <C>created_before</C>.
      </P>
      <Block lang="json" label="A list" code={JSON.stringify({ object: 'list', data: ['…'], has_more: true, next_cursor: 'cmvd2k9x40001mk30q7h2a1bc' }, null, 2)} />

      <H2>Rate limits</H2>
      <Table
        head={['', 'Limit']}
        rows={[
          ['Each key', '300 requests a minute'],
          ['Each address', '600 requests a minute'],
        ]}
      />
      <P>
        Requests over these limits receive a 429 response with <C>rate_limited</C>. The <C>RateLimit</C> and <C>RateLimit-Policy</C> headers show your remaining allowance and when it resets. For payment updates, use webhooks instead of polling.
      </P>
    </Page>
  )
}
