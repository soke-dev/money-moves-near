import { Link } from 'react-router-dom'
import { Block, C, Code, H2, H3, Next, Note, P, Page, Step, Steps, Table, UL } from '@/components/docs'

const PHP_SETUP = `<?php
require 'vendor/autoload.php';

// Reads MONEYMOVES_SECRET_KEY when you don't pass a key.
$mm = new \\MoneyMoves\\MoneyMoves(getenv('MONEYMOVES_SECRET_KEY'));`

const PHP_CHECKOUT = `$checkout = $mm->checkouts->create(
    [
        'amount' => 5000,
        'currency' => 'NGN',
        'reference' => 'order_1042',
        'customer' => ['email' => 'ada@example.com'],
        'metadata' => ['cart_id' => 'c_8812'],
        'redirect_url' => 'https://yourshop.com/orders/1042',
    ],
    ['idempotency_key' => 'order_1042']
);

header('Location: ' . $checkout['url']);`

const PHP_READ = `$checkout = $mm->checkouts->retrieve($checkoutId);
if ($checkout['status'] === 'paid') {
    echo 'Paid by ', $checkout['payment']['method'], ' ', $checkout['payment']['reference'];
}

// A payment by its id, or by the reference on the customer's receipt.
$payment = $mm->payments->retrieve('MMB-9DQMDUNU');`

const PHP_PAGES = `// One page at a time…
$page = $mm->payments->list(['status' => 'successful', 'limit' => 50]);

// …or every one, fetched as you go.
foreach ($mm->payments->each(['status' => 'successful']) as $payment) {
    echo $payment['reference'], ' ', $payment['amount_ngn'], PHP_EOL;
}`

const PHP_WEBHOOK = `<?php
require 'vendor/autoload.php';

$mm = new \\MoneyMoves\\MoneyMoves(getenv('MONEYMOVES_SECRET_KEY'));
$payload = file_get_contents('php://input');

try {
    $event = $mm->webhooks->constructEvent(
        $payload,
        $_SERVER['HTTP_MM_SIGNATURE'] ?? null,
        getenv('MONEYMOVES_WEBHOOK_SECRET')
    );
} catch (\\MoneyMoves\\SignatureException $e) {
    http_response_code(400);
    exit;
}
http_response_code(200);

if ($event['type'] === 'payment.successful') {
    $payment = $event['data']['object'];
    markOrderPaid($payment['checkout_reference']);
}`

const PHP_ERRORS = `try {
    $mm->refunds->create(['payment' => 'MMB-9DQMDUNU']);
} catch (\\MoneyMoves\\ConnectionException $e) {
    if ($e->outcomeUnknown) {
        // No answer: the refund may or may not exist. Check before asking again.
    }
} catch (\\MoneyMoves\\MoneyMovesException $e) {
    echo $e->status, ' ', $e->errorCode, ' ', $e->getMessage(), ' ', $e->requestId;
}`

const PHP_OPTIONS = `$mm = new \\MoneyMoves\\MoneyMoves($key, [
    'timeout' => 30,
    'max_retries' => 2,
]);`

export function PhpSdk() {
  return (
    <Page title="PHP SDK" lead="The official library for PHP: every endpoint, lists you can loop over, safe retries, and a webhook signature check in one call.">
      <P>
        <C>moneymoves/sdk</C> wraps the API so you don't write requests by hand. It runs on PHP 7.4 or later with the <C>curl</C> and <C>json</C> extensions, and has no other dependencies. Objects come back as associative arrays, exactly as
        the API sends them, so every field in the <Link to="/api">API reference</Link> reads the same way here.
      </P>

      <H2>Install</H2>
      <Block lang="bash" code="composer require moneymoves/sdk" />
      <Code tabs={[{ label: 'PHP', lang: 'php', code: PHP_SETUP }]} />
      <P>
        Use a test key while you build and a live key when you go live; the library talks to the same base URL either way. Keep the key on your server. See <Link to="/authentication">Authentication</Link>.
      </P>

      <H2>Make a checkout</H2>
      <P>Pass your order id as the idempotency key. If the request is retried, you get the same checkout back instead of a second one.</P>
      <Code tabs={[{ label: 'PHP', lang: 'php', code: PHP_CHECKOUT }]} />

      <H2>Read checkouts and payments</H2>
      <Code tabs={[{ label: 'PHP', lang: 'php', code: PHP_READ }]} />

      <H2>Lists</H2>
      <P>
        Every list method has an <C>each</C> twin, a generator that walks every page for you, so you can loop over all your payments without handling cursors.
      </P>
      <Code tabs={[{ label: 'PHP', lang: 'php', code: PHP_PAGES }]} />

      <H2>Check webhook signatures</H2>
      <P>
        <C>webhooks-&gt;constructEvent</C> checks the <C>mm-signature</C> header against the raw body and your signing secret, refuses anything signed more than five minutes ago, and returns the event. Read the body with{' '}
        <C>php://input</C>, before any JSON decoding.
      </P>
      <Code tabs={[{ label: 'PHP', lang: 'php', code: PHP_WEBHOOK }]} />
      <Note type="tip">Testing your handler? <C>webhooks-&gt;sign($body, $secret)</C> makes a valid header for a body of your own.</Note>

      <H2>Errors and retries</H2>
      <P>
        Any error from the API throws a <C>MoneyMovesException</C> with its HTTP <C>status</C>, the <C>errorCode</C> from <Link to="/errors">Errors</Link>, and the <C>requestId</C> to quote to support.
      </P>
      <UL>
        <li>Reads are retried twice on network errors, 429s and 5xx, with a short wait between tries.</li>
        <li>Writes are sent once. If a write gets no answer, you get a <C>ConnectionException</C> with <C>outcomeUnknown</C> set, so you can check before trying again.</li>
        <li>Give a write an <C>idempotency_key</C> and it's retried like a read, because the API never does it twice.</li>
      </UL>
      <Code tabs={[{ label: 'PHP', lang: 'php', code: PHP_ERRORS }]} />

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
      <P>The defaults are a 30 second timeout and two retries.</P>
      <Code tabs={[{ label: 'PHP', lang: 'php', code: PHP_OPTIONS }]} />

      <Next
        links={[
          ['/woocommerce', 'WooCommerce', 'take payments in your store without code.'],
          ['/webhooks', 'Webhooks', 'set up your endpoint.'],
          ['/api', 'API reference', 'every endpoint and field.'],
        ]}
      />
    </Page>
  )
}

export function WooCommerce() {
  return (
    <Page title="WooCommerce" lead="Add Money Moves to your WooCommerce checkout. Shoppers pay by bank transfer, the Money Moves app or stablecoins, and each order is marked paid the moment its payment lands.">
      <P>
        The plugin sends each order to a Money Moves checkout and marks it paid from our signed webhook. It works with the classic checkout and the block checkout, and with WooCommerce's order tables. You don't write any code.
      </P>
      <UL>
        <li>WordPress 6.0 or later, WooCommerce 7.0 or later, and PHP 7.4 or later.</li>
        <li>Your store's currency set to NGN or USD.</li>
        <li>A Money Moves Business account. Test mode works before you're verified; live payments need a verified business.</li>
      </UL>
      <P>
        <a href="/downloads/money-moves-payments.zip" download>
          Download the plugin (money-moves-payments.zip)
        </a>
      </P>

      <H2>Set it up</H2>
      <Steps>
        <Step title="Install">
          <P>In WordPress, open Plugins, Add New, Upload Plugin, choose the zip and activate it.</P>
        </Step>
        <Step title="Add your keys">
          <P>Open WooCommerce, Settings, Payments, Money Moves. Paste your test and live secret keys from the dashboard's Developer portal, API keys.</P>
        </Step>
        <Step title="Add the webhook">
          <P>
            The settings page shows your webhook address. In the Developer portal, Webhooks, add it with <C>payment.successful</C> and <C>payment.underpaid</C>, then paste its signing secret into the plugin.
          </P>
        </Step>
        <Step title="Test">
          <P>With test mode on, place an order and pay it on the test checkout. The order turns to Processing on its own.</P>
        </Step>
        <Step title="Go live">
          <P>Turn test mode off. Live orders now take real payments.</P>
        </Step>
      </Steps>

      <H2>How an order is paid</H2>
      <UL>
        <li>At checkout, the shopper is sent to a Money Moves checkout for the order's total, in the store's currency. The order waits as Pending payment.</li>
        <li>When the payment lands, our <C>payment.successful</C> webhook marks the order paid, with the payment's reference on the order. The plugin checks the signature, the order, the amount and the currency before it does.</li>
        <li>When the shopper comes back to your thank you page, the plugin checks the checkout again, so the order is right even if the webhook is late.</li>
        <li>If a shopper pays less than the total, the order goes On hold with a note. Ask them for the rest, or refund them from your dashboard.</li>
      </UL>
      <Note>Each order makes one checkout, whatever the shopper does. Retrying payment on the same order picks up the same checkout instead of making a second one, as long as its total hasn't changed.</Note>

      <H2>Where the money goes</H2>
      <P>
        Leave <strong>Where the money goes</strong> on <em>Your default from the dashboard</em> and orders settle where you chose for API payments, in the dashboard's Developer portal. Or pick your bank account, your Money Moves account or your
        business wallet for this store only. Either way, each payment settles the moment it's paid. See <Link to="/settlement">Settlement</Link>.
      </P>
      <P>
        The ways to pay a shopper sees are the ones switched on in your dashboard, under Settings, Payment methods. See <Link to="/payment-methods">Methods, coins and networks</Link>.
      </P>

      <H2>Refunds and disputes</H2>
      <P>
        Refund an order from your Money Moves dashboard, on the payment. Disputes come to the dashboard too, and the shopper follows theirs from their receipt. See <Link to="/refunds">Refunds</Link>.
      </P>

      <H2>Settings</H2>
      <Table
        head={['Setting', 'What it does']}
        rows={[
          ['Turn on', 'Shows Money Moves at checkout.'],
          ['Name at checkout', 'What shoppers see, such as “Bank transfer, Money Moves or crypto”.'],
          ['Line under it', 'A short line shown when it’s picked.'],
          ['Test mode', 'Uses your test key. Payments are simulated and nothing real moves.'],
          ['Test and live secret keys', 'From the Developer portal, API keys. Stored in WordPress, never shown to shoppers.'],
          ['Webhook signing secret', 'From the webhook you added. Orders are only marked paid by events signed with it.'],
          ['Where the money goes', 'Your dashboard default, or one place for this store.'],
        ]}
      />

      <H3>Building your own?</H3>
      <P>
        The plugin is built on the <Link to="/php">PHP SDK</Link>, which you can use for any PHP store or app.
      </P>

      <Next
        links={[
          ['/test-mode', 'Test mode', 'try every way to pay.'],
          ['/webhooks', 'Webhooks', 'how events are signed and retried.'],
          ['/php', 'PHP SDK', 'the library the plugin is built on.'],
        ]}
      />
    </Page>
  )
}
