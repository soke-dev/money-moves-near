<?php
/**
 * Money Moves as a WooCommerce payment gateway.
 *
 * At checkout the shopper picks Money Moves and is sent to a Money Moves
 * checkout for the order's total. They pay by bank transfer, the Money Moves
 * app or stablecoins, and come back to the order-received page. The order is
 * marked paid from Money Moves' signed webhook, and checked again when the
 * shopper comes back, so a slow webhook never leaves a paid order waiting.
 *
 * Only orders in NGN or USD: those are the currencies a checkout takes.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Money_Moves_Gateway extends WC_Payment_Gateway
{
    /** @var string */
    private $test_key;
    /** @var string */
    private $live_key;
    /** @var string */
    private $webhook_secret;
    /** @var bool */
    private $testmode;
    /** @var string */
    private $settle_to;

    public function __construct()
    {
        $this->id = 'money_moves';
        $this->method_title = __('Money Moves', 'money-moves-payments');
        $this->method_description = __('Take payments by bank transfer, the Money Moves app or stablecoins. You get paid to your bank account, Money Moves account or business wallet the moment each order is paid.', 'money-moves-payments');
        $this->has_fields = false;
        $this->supports = ['products'];
        $this->icon = plugins_url('assets/money-moves.png', MONEY_MOVES_WC_FILE);

        $this->init_form_fields();
        $this->init_settings();

        $this->title = $this->get_option('title');
        $this->description = $this->get_option('description');
        $this->testmode = $this->get_option('testmode') === 'yes';
        $this->test_key = trim((string) $this->get_option('test_secret_key'));
        $this->live_key = trim((string) $this->get_option('live_secret_key'));
        $this->webhook_secret = trim((string) $this->get_option('webhook_secret'));
        $this->settle_to = (string) $this->get_option('settle_to', '');

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
        add_action('woocommerce_api_money_moves', [$this, 'webhook']);
        add_action('woocommerce_thankyou_' . $this->id, [$this, 'check_on_return']);
    }

    public function init_form_fields()
    {
        $this->form_fields = [
            'enabled' => [
                'title' => __('Turn on', 'money-moves-payments'),
                'type' => 'checkbox',
                'label' => __('Take payments with Money Moves', 'money-moves-payments'),
                'default' => 'no',
            ],
            'title' => [
                'title' => __('Name at checkout', 'money-moves-payments'),
                'type' => 'text',
                'default' => __('Bank transfer, Money Moves or crypto', 'money-moves-payments'),
            ],
            'description' => [
                'title' => __('Line under it', 'money-moves-payments'),
                'type' => 'textarea',
                'default' => __('Pay by bank transfer, with the Money Moves app, or with USDC or USDT. You will be taken to a secure Money Moves page to pay.', 'money-moves-payments'),
            ],
            'testmode' => [
                'title' => __('Test mode', 'money-moves-payments'),
                'type' => 'checkbox',
                'label' => __('Use the test key: payments are simulated and nothing real moves', 'money-moves-payments'),
                'default' => 'yes',
            ],
            'test_secret_key' => [
                'title' => __('Test secret key', 'money-moves-payments'),
                'type' => 'password',
                'description' => __('Starts sk_test_. From your Money Moves dashboard, Developer portal, API keys.', 'money-moves-payments'),
            ],
            'live_secret_key' => [
                'title' => __('Live secret key', 'money-moves-payments'),
                'type' => 'password',
                'description' => __('Starts sk_live_.', 'money-moves-payments'),
            ],
            'webhook_secret' => [
                'title' => __('Webhook signing secret', 'money-moves-payments'),
                'type' => 'password',
                'description' => sprintf(
                    /* translators: %s: the webhook address */
                    __('In your Money Moves dashboard, Developer portal, Webhooks: add the endpoint %s with the events payment.successful and payment.underpaid, then paste its signing secret here.', 'money-moves-payments'),
                    '<code>' . esc_html(add_query_arg('wc-api', 'money_moves', home_url('/'))) . '</code>'
                ),
            ],
            'settle_to' => [
                'title' => __('Where the money goes', 'money-moves-payments'),
                'type' => 'select',
                'default' => '',
                'options' => [
                    '' => __('Your default from the dashboard', 'money-moves-payments'),
                    'bank' => __('Your bank account', 'money-moves-payments'),
                    'money_moves' => __('Your Money Moves account', 'money-moves-payments'),
                    'wallet' => __('Your business wallet', 'money-moves-payments'),
                ],
            ],
        ];
    }

    /** Only for NGN and USD orders, and only with a key for the mode it's in. */
    public function is_available()
    {
        if (!parent::is_available()) {
            return false;
        }
        if (!in_array(get_woocommerce_currency(), ['NGN', 'USD'], true)) {
            return false;
        }
        return $this->key() !== '';
    }

    private function key(): string
    {
        return $this->testmode ? $this->test_key : $this->live_key;
    }

    private function client(): \MoneyMoves\MoneyMoves
    {
        return new \MoneyMoves\MoneyMoves($this->key(), ['timeout' => 20]);
    }

    public function process_payment($order_id)
    {
        $order = wc_get_order($order_id);
        if (!$order) {
            wc_add_notice(__('That order could not be found.', 'money-moves-payments'), 'error');
            return ['result' => 'failure'];
        }
        $params = [
            'amount' => (float) $order->get_total(),
            'currency' => $order->get_currency(),
            'description' => sprintf(__('Order %s', 'money-moves-payments'), $order->get_order_number()),
            'reference' => (string) $order->get_order_number(),
            'customer' => array_filter(['email' => $order->get_billing_email(), 'name' => trim($order->get_formatted_billing_full_name())]),
            'metadata' => ['wc_order_id' => (string) $order->get_id(), 'wc_order_key' => $order->get_order_key()],
            'redirect_url' => $this->get_return_url($order),
            'expires_in' => 3600,
        ];
        if ($this->settle_to !== '') {
            $params['settle_to'] = $this->settle_to;
        }
        try {
            // The same order and total give the same checkout, even if the shopper presses Place order twice.
            $checkout = $this->client()->checkouts->create($params, ['idempotency_key' => 'wc-' . $order->get_order_key() . '-' . md5((string) $order->get_total())]);
        } catch (\MoneyMoves\MoneyMovesException $e) {
            $order->add_order_note(sprintf(__('Money Moves could not open a checkout: %s', 'money-moves-payments'), $e->getMessage()));
            wc_add_notice(__('We could not start the payment just now. Please try again, or choose another way to pay.', 'money-moves-payments'), 'error');
            return ['result' => 'failure'];
        }
        $order->update_meta_data('_money_moves_checkout', $checkout['id']);
        $order->update_status('pending', __('Waiting for the Money Moves payment.', 'money-moves-payments'));
        $order->save();
        return ['result' => 'success', 'redirect' => $checkout['url']];
    }

    /**
     * Money Moves' webhook. The signature is checked first; then the payment
     * is matched to its order, and the amount and currency must agree.
     */
    public function webhook()
    {
        $payload = (string) file_get_contents('php://input');
        $signature = isset($_SERVER['HTTP_MM_SIGNATURE']) ? (string) $_SERVER['HTTP_MM_SIGNATURE'] : null;
        if ($this->webhook_secret === '') {
            status_header(503);
            exit('Add the webhook signing secret in the Money Moves settings.');
        }
        try {
            $event = (new \MoneyMoves\Webhook())->constructEvent($payload, $signature, $this->webhook_secret);
        } catch (\MoneyMoves\SignatureException $e) {
            status_header(400);
            exit('Bad signature.');
        }
        $payment = $event['data']['object'] ?? [];
        $order = $this->order_for($payment);
        if ($order) {
            if ($event['type'] === 'payment.successful') {
                $this->paid($order, $payment);
            } elseif ($event['type'] === 'payment.underpaid' && !$order->is_paid()) {
                $order->update_status('on-hold', sprintf(__('Money Moves payment %s arrived short. Received NGN %s. Ask the customer for the rest, or refund it from your Money Moves dashboard.', 'money-moves-payments'), $payment['reference'] ?? '', $payment['received_ngn'] ?? '0'));
            }
        }
        status_header(200);
        exit('ok');
    }

    /** The shopper is back: if the webhook hasn't arrived yet, ask Money Moves directly. */
    public function check_on_return($order_id)
    {
        $order = wc_get_order($order_id);
        if (!$order || $order->is_paid() || $order->get_payment_method() !== $this->id) {
            return;
        }
        $checkout_id = (string) $order->get_meta('_money_moves_checkout');
        if ($checkout_id === '') {
            return;
        }
        try {
            $checkout = $this->client()->checkouts->retrieve($checkout_id);
        } catch (\MoneyMoves\MoneyMovesException $e) {
            return;
        }
        if (($checkout['status'] ?? '') === 'paid' && !empty($checkout['payment'])) {
            $this->paid($order, $checkout['payment']);
        }
    }

    /** @param array<string, mixed> $payment */
    private function order_for(array $payment)
    {
        $id = $payment['metadata']['wc_order_id'] ?? null;
        $order = $id ? wc_get_order((int) $id) : null;
        if (!$order) {
            return null;
        }
        // The key must match too: a metadata id alone isn't enough to touch an order.
        if (($payment['metadata']['wc_order_key'] ?? '') !== $order->get_order_key()) {
            return null;
        }
        return $order;
    }

    /** @param array<string, mixed> $payment */
    private function paid(WC_Order $order, array $payment): void
    {
        if ($order->is_paid()) {
            return;
        }
        $currency = $order->get_currency();
        $expected = (float) $order->get_total();
        $paid = $currency === 'NGN' ? (float) ($payment['amount_ngn'] ?? 0) : (float) ($payment['amount_usd'] ?? 0);
        if (($payment['currency'] ?? '') !== $currency || abs($paid - $expected) > 0.01) {
            $order->update_status('on-hold', sprintf(__('Money Moves payment %s does not match this order (%s %s paid, %s %s due). Check it in your Money Moves dashboard.', 'money-moves-payments'), $payment['reference'] ?? '', $payment['currency'] ?? '', $paid, $currency, $expected));
            return;
        }
        $order->payment_complete((string) ($payment['reference'] ?? ''));
        $order->add_order_note(sprintf(__('Paid with Money Moves: %s, payment %s.', 'money-moves-payments'), $this->method_name($payment['method'] ?? ''), $payment['reference'] ?? ''));
    }

    private function method_name(string $method): string
    {
        $names = ['bank_transfer' => __('bank transfer', 'money-moves-payments'), 'app' => __('the Money Moves app', 'money-moves-payments'), 'crypto' => __('crypto', 'money-moves-payments')];
        return $names[$method] ?? $method;
    }
}
