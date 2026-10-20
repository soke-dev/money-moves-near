<?php
// Runs with a stubbed transport: no network, no key that works. php tests/run.php
declare(strict_types=1);

require __DIR__ . '/../src/MoneyMoves.php';

use MoneyMoves\ConnectionException;
use MoneyMoves\MoneyMoves;
use MoneyMoves\MoneyMovesException;
use MoneyMoves\SignatureException;

$failed = 0;
function check(bool $ok, string $what): void
{
    global $failed;
    echo ($ok ? 'PASS ' : 'FAIL ') . $what . PHP_EOL;
    if (!$ok) {
        $failed++;
    }
}

/** A transport that answers from a list, and remembers what it was asked. */
function fake(array $answers, array &$calls): callable
{
    return function (string $method, string $url, array $headers, ?string $body) use (&$answers, &$calls): array {
        $calls[] = ['method' => $method, 'url' => $url, 'headers' => $headers, 'body' => $body];
        $a = array_shift($answers);
        if ($a instanceof \Throwable) {
            throw $a;
        }
        return ['status' => $a['status'] ?? 200, 'body' => json_encode($a['body'] ?? []), 'headers' => $a['headers'] ?? []];
    };
}

$KEY = 'sk_test_' . str_repeat('x', 40);

try {
    new MoneyMoves('pk_nope');
    check(false, 'refuses a malformed key');
} catch (\InvalidArgumentException $e) {
    check(true, 'refuses a malformed key');
}

$calls = [];
$mm = new MoneyMoves($KEY, ['base_url' => 'https://api.example/v1', 'transport' => fake([['status' => 201, 'body' => ['id' => 'co_1', 'url' => 'https://pay/x']]], $calls)]);
$c = $mm->checkouts->create(['amount' => 5000, 'currency' => 'NGN', 'reference' => 'order_1'], ['idempotency_key' => 'order_1']);
check($c['id'] === 'co_1', 'creates a checkout');
check($calls[0]['url'] === 'https://api.example/v1/checkouts' && $calls[0]['method'] === 'POST', 'posts to /checkouts');
check(in_array('Authorization: Bearer ' . $KEY, $calls[0]['headers'], true), 'sends the key');
check(in_array('Idempotency-Key: order_1', $calls[0]['headers'], true), 'sends the idempotency key');
check(json_decode($calls[0]['body'], true) === ['amount' => 5000, 'currency' => 'NGN', 'reference' => 'order_1'], 'sends the body');
check($mm->mode() === 'test', 'knows its mode');

// Reads retry on a 500, then succeed.
$calls = [];
$mm = new MoneyMoves($KEY, ['base_url' => 'https://api.example/v1', 'transport' => fake([['status' => 500, 'body' => ['error' => ['code' => 'server', 'message' => 'x']]], ['body' => ['id' => 'pay_1']]], $calls)]);
check($mm->payments->retrieve('MMB-1')['id'] === 'pay_1' && count($calls) === 2, 'retries a read after a 500');

// A write without a key is sent once; a lost answer means the outcome is unknown.
$calls = [];
$mm = new MoneyMoves($KEY, ['base_url' => 'https://api.example/v1', 'transport' => fake([new \RuntimeException('reset')], $calls)]);
try {
    $mm->refunds->create(['payment' => 'MMB-1']);
    check(false, 'a lost write is reported');
} catch (ConnectionException $e) {
    check($e->outcomeUnknown && count($calls) === 1, 'a lost write is sent once and reported as unknown');
}

// API errors come through with their code and request id.
$calls = [];
$mm = new MoneyMoves($KEY, ['base_url' => 'https://api.example/v1', 'transport' => fake([['status' => 404, 'body' => ['error' => ['code' => 'not_found', 'message' => 'No payment', 'request_id' => 'req_1']]]], $calls)]);
try {
    $mm->payments->retrieve('nope');
    check(false, 'throws API errors');
} catch (MoneyMovesException $e) {
    check($e->status === 404 && $e->errorCode === 'not_found' && $e->requestId === 'req_1', 'throws API errors with code and request id');
}

// Lists page through.
$calls = [];
$mm = new MoneyMoves($KEY, ['base_url' => 'https://api.example/v1', 'transport' => fake([
    ['body' => ['object' => 'list', 'data' => [['id' => 'a'], ['id' => 'b']], 'has_more' => true, 'next_cursor' => 'b']],
    ['body' => ['object' => 'list', 'data' => [['id' => 'c']], 'has_more' => false, 'next_cursor' => null]],
], $calls)]);
$ids = [];
foreach ($mm->payments->each(['status' => 'successful']) as $p) {
    $ids[] = $p['id'];
}
check($ids === ['a', 'b', 'c'], 'each walks every page');
check(strpos($calls[1]['url'], 'starting_after=b') !== false && strpos($calls[0]['url'], 'status=successful') !== false, 'each passes the cursor and the filters');

// Disputes.
$calls = [];
$mm = new MoneyMoves($KEY, ['base_url' => 'https://api.example/v1', 'transport' => fake([['body' => ['id' => 'd1', 'status' => 'under_review']]], $calls)]);
$d = $mm->disputes->reply('MMBD-7K2Q9XHD', ['message' => 'Delivered Monday.']);
check($d['status'] === 'under_review' && $calls[0]['url'] === 'https://api.example/v1/disputes/MMBD-7K2Q9XHD/reply', 'replies to a dispute');
try {
    $mm->payments->create([]);
    check(false, 'refuses what a resource cannot do');
} catch (\BadMethodCallException $e) {
    check(true, 'refuses what a resource cannot do');
}

// Webhooks: the same signature the API makes.
$secret = 'whsec_test';
$body = '{"id":"evt_1","type":"payment.successful","data":{"object":{"id":"pay_1"}}}';
$sig = $mm->webhooks->sign($body, $secret);
$event = $mm->webhooks->constructEvent($body, $sig, $secret);
check($event['type'] === 'payment.successful', 'checks a good signature');
try {
    $mm->webhooks->constructEvent($body . ' ', $sig, $secret);
    check(false, 'refuses a changed body');
} catch (SignatureException $e) {
    check(true, 'refuses a changed body');
}
try {
    $mm->webhooks->constructEvent($body, $mm->webhooks->sign($body, $secret, time() - 3600), $secret);
    check(false, 'refuses an old signature');
} catch (SignatureException $e) {
    check(true, 'refuses an old signature');
}
// Matches the Node SDK's signature for the same input.
$fixed = $mm->webhooks->sign('{"a":1}', 'whsec_test', 1700000000);
check($fixed === 't=1700000000,v1=' . hash_hmac('sha256', '1700000000.{"a":1}', 'whsec_test'), 'signs the documented way');

echo $failed ? "{$failed} FAILED" . PHP_EOL : 'ALL PASSED' . PHP_EOL;
exit($failed ? 1 : 0);
