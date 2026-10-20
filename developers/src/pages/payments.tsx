import { Link } from 'react-router-dom'
import { Accordion, C, Code, H2, H3, Next, Note, OL, P, Page, Step, Steps, Table, UL } from '@/components/docs'
import { Request } from '@/components/api'
import { DASHBOARD_URL } from '@/nav'

/* ─── How payments work ────────────────────────────────────────────── */

export function HowPaymentsWork() {
  return (
    <Page title="How payments work" lead="A checkout, a payment link, an invoice and a store QR look different to your customer, but underneath every one of them works the same way.">
      <P>
        A <b>checkout</b> (or payment link, invoice or store QR) is what you create: a payment page with an amount or pricing rules. A <b>payment</b> is one attempt to pay through one method. If a customer starts a bank transfer, then switches to USDT, the first payment attempt expires and the second is recorded separately.
      </P>

      <H2>The life of a payment</H2>
      <Steps>
        <Step title="The customer opens the page">
          <P>The customer sees your name and logo, what they're paying for, and the price in local currency and US dollars at the current rate. They enter an email address for the receipt, provide their name or phone number if requested, then choose a payment method.</P>
        </Step>
        <Step title="A payment opens">
          <P>
            The next step depends on the method. For a <b>bank transfer</b>, we provide a one-time account for this payment, so the customer doesn't need to enter a payment reference. For <b>crypto</b>, we provide a payment-specific address; on Stellar and TON, we use a shared address with a memo. For the <b>Money Moves app</b>, the customer receives a request to approve in the app. The exchange rate is fixed when the payment opens, and the payment remains open for 30 minutes.
          </P>
        </Step>
        <Step title="The money arrives">
          <P>
            We confirm the transfer with the bank or the crypto transaction on its network. If the full amount arrives, the payment is <C>successful</C>. If less arrives, its status is <C>underpaid</C> and the funds are held until you request the remaining amount or issue a refund. If no funds arrive before the payment closes, its status is <C>expired</C>.
          </P>
        </Step>
        <Step title="It settles, straight away">
          <P>
            Each successful payment is settled as soon as it's confirmed: local currency to your bank account, or USDC to a linked Money Moves account or your business wallet. Payments settle individually rather than in batches. See{' '}
            <Link to="/settlement">Settlement</Link>.
          </P>
        </Step>
        <Step title="Everyone hears about it">
          <P>
            The customer receives an email receipt. Your server receives <C>payment.successful</C>, followed by <C>settlement.completed</C> when the funds arrive. You can also view the payment and its details in the dashboard.
          </P>
        </Step>
      </Steps>

      <H2>Money that arrives late, short or twice</H2>
      <Accordion
        items={[
          [
            'A transfer for less than the amount',
            <>
              The payment status becomes <C>underpaid</C>, and the funds are held. The amount received appears in <C>received_ngn</C>. You can refund the payment from the dashboard; because it hasn't been settled, you don't need to fund the refund.
            </>,
          ],
          [
            'Crypto that arrives after the payment closed',
            <>We continue monitoring each payment address after the payment closes. If funds arrive late, the payment reopens briefly and the funds are credited, so a delayed transfer isn't lost.</>,
          ],
          [
            'More crypto than the amount',
            <>The payment is marked successful, and the excess is set aside for return to the customer. The customer is asked where to receive it.</>,
          ],
          [
            'A customer pays twice',
            <>Each attempt is a separate payment, so both are recorded. Refund the duplicate from the dashboard or through the API.</>,
          ],
        ]}
      />

      <H2>How many payments each thing takes</H2>
      <Table
        head={['', 'Takes', 'Made in']}
        rows={[
          [<Link to="/checkout">Checkout</Link>, 'One payment, for one amount', 'The API'],
          [<Link to="/payment-links">Payment link</Link>, 'As many as you like', 'The dashboard'],
          [<Link to="/invoices">Invoice</Link>, 'One payment, for its total', 'The dashboard'],
          [<Link to="/store-qr">Store QR</Link>, 'As many as you like, any amount', 'The dashboard'],
        ]}
      />
      <Next
        links={[
          ['/checkout', 'Checkout', 'take payments from your own site or app.'],
          ['/payment-methods', 'Methods, coins and networks', 'every way a customer can pay.'],
          ['/statuses', 'Statuses', 'every status and what to do about it.'],
        ]}
      />
    </Page>
  )
}

/* ─── Checkout ─────────────────────────────────────────────────────── */

const MOBILE = `// In your app: ask your own server for a checkout, then open it.
import * as WebBrowser from "expo-web-browser";

const res = await fetch("https://yourshop.com/api/orders", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ items: basket }),
});
const { order } = await res.json();

await WebBrowser.openBrowserAsync(order.url);
// The customer is back. Ask your server whether the order is paid.`

export function Checkout() {
  return (
    <Page title="Checkout" lead="For your own website or app. Your server makes a checkout for each order, you send the customer to it, and you ship when the payment lands.">
      <P>
        Create a checkout through the API to collect one payment for a specific amount. Each checkout includes a hosted page that displays the price in local currency and US dollars, offers the payment methods you've enabled, and provides the required bank account or crypto address. You don't need to build a payment form or handle customers' bank details.
      </P>

      <H2>The flow</H2>
      <Steps>
        <Step title="Make a checkout on your server">
          <P>
            When the customer is ready to pay, your server creates a checkout with the amount and your order ID. Send that order ID as the <C>Idempotency-Key</C> too, so retries don't create duplicate checkouts.
          </P>
          <Request method="POST" path="/checkouts" idempotent body={{ amount: 5000, currency: 'NGN', reference: 'order_1042', customer: { email: 'ada@example.com', name: 'Ada Okafor' }, metadata: { cart_id: 'c_8812' }, expires_in: 3600, redirect_url: 'https://yourshop.com/orders/1042' }} />
        </Step>
        <Step title="Send the customer to the checkout URL">
          <P>
            Redirect the customer's browser to the checkout's <C>url</C>. If you included their name and email, those fields are prefilled. After payment, the checkout page sends them to your <C>redirect_url</C>.
          </P>
        </Step>
        <Step title="Wait for payment.successful">
          <P>
            Your webhook receives <C>payment.successful</C> with the payment object. Use <C>checkout_reference</C> to match it to your order and read any <C>metadata</C> you sent. Then mark the order as paid and fulfil it.
          </P>
          <Note type="warn" title="Don't ship on the redirect">
            A customer can reach your redirect page without paying, by going back or typing the address. Treat the webhook, or a fresh read of the checkout, as the only proof of payment.
          </Note>
        </Step>
      </Steps>

      <H2>What you can set on each checkout</H2>
      <Table
        head={['Field', 'What it does']}
        rows={[
          [<C>methods</C>, <>Limit the ways to pay to some of <C>bank_transfer</C>, <C>app</C> and <C>crypto</C>. Left out, the customer can use every way that's switched on.</>],
          [<C>accept</C>, <>For crypto, which coins on which networks, such as <C>{'{"USDC": ["Solana", "Base"]}'}</C>.</>],
          [<C>customer</C>, 'Their email and name, filled in on the page. The email gets the receipt.'],
          [<C>metadata</C>, 'Up to 20 keys of your own data. It comes back on the checkout, its payment and every event.'],
          [<><C>expires_in</C> or <C>expires_at</C></>, 'Close the checkout after 5 minutes to 30 days. Left out, it stays open until it’s paid or cancelled.'],
          [<C>fee_payer</C>, <>Have the customer pay the processing fee on this checkout, or pay it yourself. See <Link to="/fees">Fees</Link>.</>],
          [<C>settle_to</C>, <>Send this checkout's money to your bank, a Money Moves account or your business wallet.</>],
          [<C>redirect_url</C>, 'Where the page sends the customer after they pay.'],
        ]}
      />

      <H2>Checking a checkout yourself</H2>
      <P>
        Webhooks are the fastest way to receive payment updates, but you can also retrieve a checkout by its ID. When it has been paid, <C>status</C> is <C>paid</C> and <C>payment</C> contains the payment object. This is useful on an order page or when your server was unavailable during webhook delivery.
      </P>
      <Request method="GET" path="/checkouts/cmvcmijdb000gob30t89lhukg" />

      <H2>Changing your mind</H2>
      <P>
        If an order is cancelled before payment, <Link to="/api/checkouts#cancel">cancel the checkout</Link> to stop new payment attempts. A customer who has already started a bank transfer may still complete it, and that payment will still count, so continue monitoring for payments. If the checkout is already paid, refund the payment instead.
      </P>

      <H2>In a mobile app</H2>
      <P>Your app must not store a secret key. It requests an order from your server, which creates the checkout. The app opens the checkout URL in an in-app browser, then asks your server whether the order is paid when the browser closes.</P>
      <Code tabs={[{ label: 'App.tsx', lang: 'ts', code: MOBILE }]} />

      <Next
        links={[
          ['/api/checkouts', 'Checkouts API', 'every field and endpoint, with examples.'],
          ['/webhooks', 'Webhooks', 'set up your endpoint and check signatures.'],
          ['/idempotency', 'Idempotency', 'retry safely without making two checkouts.'],
        ]}
      />
    </Page>
  )
}

/* ─── Payment links ────────────────────────────────────────────────── */

export function PaymentLinks() {
  return (
    <Page title="Payment links" lead="Create a reusable payment page in the dashboard and share its link with customers.">
      <P>
        Create a payment link without writing code. Set a name and price, then share the link by message, email or QR code. Each customer sees a hosted payment page, and each payment is recorded separately.
      </P>

      <H2>Making a link</H2>
      <P>
        Open <a href={`${DASHBOARD_URL}/collect/links`}>Payment links</a> and select New. Configure:
      </P>
      <Table
        head={['Setting', 'What it does']}
        rows={[
          ['Name and description', 'Displayed on the payment page and customer receipt.'],
          ['Price', 'Set a fixed amount in NGN or USD, or let the customer choose an amount. You can set a minimum for customer-entered amounts.'],
          ['Address', 'Your link on the Money Moves checkout site, such as pay.usemoneymoves.xyz/ada-shoes.'],
          ['Payment methods', 'Choose local fiat or crypto methods, including bank transfers, the Money Moves app, and the coins and networks you accept.'],
          ['Settlement destination', 'Choose a bank account, a Money Moves account or your business wallet for payments from this link.'],
          ['Customer details', 'Request the customer’s name and phone number in addition to their email.'],
          ['After payment', 'Choose where to send the customer after payment.'],
          ['Fee payer', 'Choose whether your business or the customer pays the fee.'],
        ]}
      />
      <P>You can pause a link at any time. Customers will see that it isn't accepting payments until you reactivate it.</P>

      <H2>Payments through a link</H2>
      <P>
        Each payment appears in your dashboard and in the <Link to="/api/payments">Payments API</Link>. Its <C>checkout</C> field contains the link ID, and it triggers the same <Link to="/webhooks/events">events</Link> as an API checkout. You can export paid payments from a link, including payer and method details, as a spreadsheet or PDF.
      </P>
      <Note type="tip">For a single order with an amount set by your server and linked to your order ID, use a <Link to="/checkout">checkout</Link>.</Note>
    </Page>
  )
}

/* ─── Invoices ─────────────────────────────────────────────────────── */

export function Invoices() {
  return (
    <Page title="Invoices" lead="Email a customer an itemised bill with a payment link and due date.">
      <P>
        Each invoice lists the items, total and due date for one customer. We email it in your business's name. The customer follows the link to pay the total using an available local fiat or crypto method. An invoice is paid in one payment.
      </P>

      <H2>Sending an invoice</H2>
      <OL>
        <li>
          Open <a href={`${DASHBOARD_URL}/collect/invoices`}>Invoices</a> and choose New.
        </li>
        <li>Enter the customer's name and email, add each item and its price, and set the due date. You can also include a note.</li>
        <li>Select the available payment methods and settlement destination.</li>
        <li>Send the invoice. It gets a unique number, and the customer receives an email with a payment link such as pay.usemoneymoves.xyz/i/….</li>
      </OL>

      <H2>After it's sent</H2>
      <P>
        The dashboard shows when the customer opens the invoice. You can send a reminder or void an invoice that was created by mistake. After payment, the invoice is marked paid, the customer receives a receipt, and your server receives <C>payment.successful</C> and{' '}
        <C>invoice.paid</C> events.
      </P>
      <Note type="tip" title="Paid by an AI agent">
        Customers can also give the invoice link to an AI assistant like Claude or ChatGPT, using the <Link to="/agents">Money Moves plugin for PayBox</Link>, then approve the proposed payment in PayBox.
      </Note>
    </Page>
  )
}

/* ─── Store QR ─────────────────────────────────────────────────────── */

export function StoreQr() {
  return (
    <Page title="Store QR" lead="Accept in-person payments with a QR code for each till or outlet.">
      <P>
        Store QRs are designed for businesses where the amount varies by customer, such as shops, kiosks and restaurants. Each outlet has its own QR code and address, so you can identify which till or branch received each payment.
      </P>
      <H2>Setting one up</H2>
      <OL>
        <li>
          Open <a href={`${DASHBOARD_URL}/collect/outlets`}>Outlets</a> and add one, with a name and where it is.
        </li>
        <li>Choose available payment methods and a settlement destination, and decide whether to request the customer's name.</li>
        <li>Add a staff member's email if they should receive updates about payments at that outlet.</li>
        <li>Print the QR code or display it on a screen at the counter.</li>
      </OL>
      <H2>At the counter</H2>
      <P>The customer scans the QR code, enters the amount and pays using an available method. The outlet is shown in the dashboard and in the payment's <C>outlet</C> field in the API.</P>
    </Page>
  )
}

/* ─── Methods ──────────────────────────────────────────────────────── */

export function PaymentMethods() {
  return (
    <Page title="Methods, coins and networks" lead="Customers can pay in local fiat or crypto. These are the available methods and supported assets.">
      <Table
        head={['Method', 'How the customer pays', 'In the API']}
        rows={[
          ['Local fiat', 'The customer pays in NGN from any bank app to a one-time account created for the payment.', <C>bank_transfer</C>],
          ['Money Moves app', 'The customer approves a payment request in the app or scans a code with another phone.', <C>app</C>],
          ['Crypto', 'The customer sends USDC or USDT from a wallet or exchange to the address provided for the payment.', <C>crypto</C>],
        ]}
      />

      <H2>Turning methods on and off</H2>
      <P>
        Each method is on once there's somewhere for its money to go, and you can switch any of them off in the dashboard, under Settings, Payment methods. Local fiat needs a checked bank account, the Money Moves app needs a linked Money Moves
        account, and crypto needs your business wallet or a linked Money Moves account. A method that's off isn't offered on any payment link, invoice, store QR or API checkout. In test mode only the switch counts.
      </P>
      <P>
        An API checkout that leaves out <C>methods</C> offers every method that's on. One that asks for a method that's off is refused with <C>method_off</C>, so you can tell your customer before they reach checkout.
      </P>

      <H2>Coins and networks</H2>
      <P>Customers can pay with USDC or USDT on the networks listed below. Most networks provide a unique address for each payment. Stellar and TON use a shared address and a payment-specific memo.</P>
      <Table
        head={['Network', 'USDC', 'USDT', 'How it is paid']}
        rows={[
          ['Movement', '✓', '✓', 'An address for this payment'],
          ['Solana', '✓', '✓', 'An address for this payment'],
          ['Base', '✓', '✓', 'An address for this payment'],
          ['BNB Chain', '✓', '✓', 'An address for this payment'],
          ['Arbitrum', '✓', '✓', 'An address for this payment'],
          ['Optimism', '✓', '✓', 'An address for this payment'],
          ['Monad', '✓', '✓', 'An address for this payment'],
          ['Arc', '✓', '', 'An address for this payment'],
          ['Stellar', '✓', '✓', 'Our address, with a memo'],
          ['TON', '', '✓', 'Our address, with a memo'],
        ]}
      />
      <P>
        Use <C>accept</C> to choose accepted coin and network combinations for a checkout. You can also configure them for each payment link, invoice or outlet in the dashboard. If a network is temporarily unavailable, it won't be offered on new checkouts.
      </P>
      <H3>The memo on Stellar and TON</H3>
      <P>
        On Stellar and TON, the memo identifies which payment a transfer belongs to. The checkout displays the memo next to the address. If a customer omits it, the funds may still arrive, but they should contact support with the transaction details so we can identify the payment.
      </P>
      <Note>Crypto payments settle as USDC on the network you selected, or in local currency if you chose a bank account as the settlement destination.</Note>
    </Page>
  )
}

/* ─── Currencies ───────────────────────────────────────────────────── */

export function Currencies() {
  return (
    <Page title="Local fiat and dollars" lead="Set a price in NGN or USD. Customers see the converted amount and pay in the currency supported by their method.">
      <P>
        Set the price for each checkout, payment link or invoice in <C>NGN</C> (naira) or <C>USD</C>. The payment page also displays the converted amount using the current exchange rate, so customers can see what they owe before choosing a method.
      </P>
      <H2>How amounts convert</H2>
      <UL>
        <li>
          Local fiat payments are made in NGN. If you set a USD price, it's converted to NGN using the current <Link to="/api/rates">rate</Link>.
        </li>
        <li>Crypto and Money Moves app payments use USD. USDC and USDT are valued at one US dollar each. An NGN price is converted to USD using the same rate.</li>
        <li>The exchange rate is fixed when the payment opens and stays the same for the life of that payment.</li>
      </UL>
      <P>
        Each payment includes <C>amount_ngn</C>, <C>amount_usd</C> and the <C>rate_ngn_per_usd</C> used to calculate the conversion.
      </P>
      <Note>The same rate is used by the Money Moves app and the checkout. If the rate is temporarily unavailable, the API returns an error instead of using an outdated value.</Note>
    </Page>
  )
}
