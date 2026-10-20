# Money Moves Business for PHP

The official PHP library for the [Money Moves Business API](https://docs.usemoneymoves.xyz): take payments by bank transfer, the Money Moves app or stablecoins, and follow settlements, refunds and disputes.

PHP 7.4 or later, with the `curl` and `json` extensions. No other dependencies.

## Install

```bash
composer require moneymoves/sdk
```

## Use

```php
<?php
require 'vendor/autoload.php';

$mm = new \MoneyMoves\MoneyMoves(getenv('MONEYMOVES_SECRET_KEY'));

$checkout = $mm->checkouts->create(
    ['amount' => 5000, 'currency' => 'NGN', 'reference' => 'order_1042', 'redirect_url' => 'https://yourshop.com/thanks'],
    ['idempotency_key' => 'order_1042']
);
header('Location: ' . $checkout['url']);

foreach ($mm->payments->each(['status' => 'successful']) as $payment) {
    echo $payment['reference'], ' ', $payment['amount_ngn'], PHP_EOL;
}
```

Objects come back as associative arrays, exactly as the API sends them. Every resource takes an id or a reference:

| Resource | Methods |
| --- | --- |
| `checkouts` | `create`, `retrieve`, `list`, `each`, `cancel` |
| `payments` | `retrieve`, `list`, `each` |
| `settlements` | `retrieve`, `list`, `each` |
| `refunds` | `create`, `retrieve`, `list`, `each`, `cancel`, `simulate` (test keys) |
| `disputes` | `retrieve`, `list`, `each`, `reply`, `create` and `accept` (test keys) |
| `events` | `retrieve`, `list`, `each` |
| `account`, `balance`, `rates` | `retrieve()` |

## Webhooks

```php
$payload = file_get_contents('php://input');
try {
    $event = $mm->webhooks->constructEvent($payload, $_SERVER['HTTP_MM_SIGNATURE'] ?? null, getenv('MONEYMOVES_WEBHOOK_SECRET'));
} catch (\MoneyMoves\SignatureException $e) {
    http_response_code(400);
    exit;
}
if ($event['type'] === 'payment.successful') {
    // Fulfil the order: $event['data']['object']
}
http_response_code(200);
```

Pass the raw body, before any JSON decoding.

## Errors and retries

API errors throw `MoneyMoves\MoneyMovesException` with `status`, `errorCode` and `requestId`. Reads are retried on network errors, 429 and 5xx. A write is sent once, unless you give it an `idempotency_key`: then it's retried safely. If a write without one gets no answer, you get a `ConnectionException` with `outcomeUnknown` set, so you can check before trying again.

## Options

```php
new \MoneyMoves\MoneyMoves($key, ['timeout' => 30, 'max_retries' => 2, 'base_url' => 'https://business.usemoneymoves.xyz/api/v1']);
```

## License

MIT
