<?php

declare(strict_types=1);

namespace MoneyMoves;

require_once __DIR__ . '/Errors.php';
require_once __DIR__ . '/Webhook.php';

/**
 * The Money Moves Business API, from PHP.
 *
 *   $mm = new \MoneyMoves\MoneyMoves(getenv('MONEYMOVES_SECRET_KEY'));
 *   $checkout = $mm->checkouts->create(['amount' => 5000, 'currency' => 'NGN', 'reference' => 'order_1042'], ['idempotency_key' => 'order_1042']);
 *   header('Location: ' . $checkout['url']);
 *
 * Objects come back as associative arrays, exactly as the API sends them.
 * Reads are retried on network errors, 429 and 5xx. A write is sent once,
 * unless you give it an idempotency key, which makes retrying it safe.
 */
class MoneyMoves
{
    public const VERSION = '1.0.0';
    public const DEFAULT_BASE = 'https://business.usemoneymoves.xyz/api/v1';

    /** @var string */
    private $key;
    /** @var string */
    private $base;
    /** @var int */
    private $timeout;
    /** @var int */
    private $maxRetries;
    /** @var callable|null For tests: fn(string $method, string $url, array $headers, ?string $body): array{status:int, body:string, headers:array} */
    private $transport;

    /** @var Resource */ public $account;
    /** @var Resource */ public $checkouts;
    /** @var Resource */ public $payments;
    /** @var Resource */ public $settlements;
    /** @var Resource */ public $refunds;
    /** @var Resource */ public $disputes;
    /** @var Resource */ public $events;
    /** @var Resource */ public $balance;
    /** @var Resource */ public $rates;
    /** @var Webhook */ public $webhooks;

    /**
     * @param string|null $apiKey Your secret key, sk_test_… or sk_live_…. Defaults to MONEYMOVES_SECRET_KEY.
     * @param array{base_url?: string, timeout?: int, max_retries?: int, transport?: callable} $options
     */
    public function __construct(?string $apiKey = null, array $options = [])
    {
        $key = $apiKey ?: (getenv('MONEYMOVES_SECRET_KEY') ?: null);
        if (!$key || !preg_match('/^sk_(test|live)_/', $key)) {
            throw new \InvalidArgumentException('Pass your secret key (sk_test_… or sk_live_…), or set MONEYMOVES_SECRET_KEY.');
        }
        $this->key = $key;
        $this->base = rtrim($options['base_url'] ?? self::DEFAULT_BASE, '/');
        $this->timeout = (int) ($options['timeout'] ?? 30);
        $this->maxRetries = (int) ($options['max_retries'] ?? 2);
        $this->transport = $options['transport'] ?? null;

        $this->account = new Resource($this, '/account', ['retrieve']);
        $this->checkouts = new Resource($this, '/checkouts', ['create', 'retrieve', 'list', 'each', 'cancel']);
        $this->payments = new Resource($this, '/payments', ['retrieve', 'list', 'each']);
        $this->settlements = new Resource($this, '/settlements', ['retrieve', 'list', 'each']);
        $this->refunds = new Resource($this, '/refunds', ['create', 'retrieve', 'list', 'each', 'cancel', 'simulate']);
        $this->disputes = new Resource($this, '/disputes', ['create', 'retrieve', 'list', 'each', 'reply', 'accept']);
        $this->events = new Resource($this, '/events', ['retrieve', 'list', 'each']);
        $this->balance = new Resource($this, '/balance', ['retrieve']);
        $this->rates = new Resource($this, '/rates', ['retrieve']);
        $this->webhooks = new Webhook();
    }

    /** The mode this key works in: "test" or "live". */
    public function mode(): string
    {
        return strpos($this->key, 'sk_live_') === 0 ? 'live' : 'test';
    }

    /**
     * One request, with retries where they're safe.
     *
     * @param array<string, mixed>|null $body
     * @param array{idempotency_key?: string} $opts
     * @return array<string, mixed>
     */
    public function request(string $method, string $path, ?array $body = null, array $opts = []): array
    {
        $retryable = $method === 'GET' || !empty($opts['idempotency_key']);
        $tries = $retryable ? $this->maxRetries + 1 : 1;
        $headers = [
            'Authorization: Bearer ' . $this->key,
            'Accept: application/json',
            'User-Agent: moneymoves-php/' . self::VERSION,
        ];
        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
        }
        if (!empty($opts['idempotency_key'])) {
            $headers[] = 'Idempotency-Key: ' . $opts['idempotency_key'];
        }
        $payload = $body === null ? null : json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $last = null;
        for ($attempt = 0; $attempt < $tries; $attempt++) {
            if ($attempt > 0) {
                usleep((int) ((min(2000, 300 * (2 ** ($attempt - 1))) + random_int(0, 100)) * 1000));
            }
            try {
                $res = $this->send($method, $this->base . $path, $headers, $payload);
            } catch (\RuntimeException $e) {
                $last = $e;
                continue;
            }
            $json = json_decode($res['body'], true);
            if ($res['status'] >= 200 && $res['status'] < 300) {
                return is_array($json) ? $json : [];
            }
            $error = is_array($json) && isset($json['error']) && is_array($json['error']) ? $json['error'] : [];
            $err = new MoneyMovesException(
                $error['message'] ?? ('Money Moves answered ' . $res['status'] . '.'),
                $res['status'],
                $error['code'] ?? 'error',
                $error['request_id'] ?? ($res['headers']['mm-request-id'] ?? null)
            );
            // A first try still running under the same idempotency key: wait for it, then ask again.
            $stillRunning = $res['status'] === 409 && $err->errorCode === 'idempotency_in_progress';
            if ($retryable && ($res['status'] === 429 || $res['status'] >= 500 || $stillRunning) && $attempt < $tries - 1) {
                $last = $err;
                continue;
            }
            throw $err;
        }
        if ($last instanceof MoneyMovesException) {
            throw $last;
        }
        throw new ConnectionException(
            $retryable
                ? trim("Couldn't reach Money Moves after {$tries} tries. " . ($last ? $last->getMessage() : ''))
                : "No answer from Money Moves, so this {$method} may or may not have gone through. Check before trying again, or send an idempotency key so retries are safe.",
            !$retryable
        );
    }

    /**
     * Every item of a list, page after page.
     *
     * @param array<string, mixed> $params
     * @return \Generator<int, array<string, mixed>>
     */
    public function pages(string $path, array $params = []): \Generator
    {
        $cursor = $params['starting_after'] ?? null;
        do {
            $query = $params;
            if ($cursor) {
                $query['starting_after'] = $cursor;
            }
            $page = $this->request('GET', $path . self::query($query));
            foreach ($page['data'] ?? [] as $item) {
                yield $item;
            }
            $cursor = !empty($page['has_more']) ? ($page['next_cursor'] ?? null) : null;
        } while ($cursor);
    }

    /** @param array<string, mixed> $params */
    public static function query(array $params): string
    {
        $clean = [];
        foreach ($params as $k => $v) {
            if ($v === null) {
                continue;
            }
            if ($v instanceof \DateTimeInterface) {
                $v = $v->format(DATE_ATOM);
            } elseif (is_bool($v)) {
                $v = $v ? 'true' : 'false';
            }
            $clean[$k] = $v;
        }
        return $clean ? '?' . http_build_query($clean) : '';
    }

    /**
     * @param string[] $headers
     * @return array{status:int, body:string, headers:array<string,string>}
     */
    private function send(string $method, string $url, array $headers, ?string $body): array
    {
        if ($this->transport) {
            return ($this->transport)($method, $url, $headers, $body);
        }
        $ch = curl_init($url);
        $responseHeaders = [];
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeout,
            CURLOPT_CONNECTTIMEOUT => min(10, $this->timeout),
            CURLOPT_HEADERFUNCTION => function ($curl, $line) use (&$responseHeaders) {
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) {
                    $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
                }
                return strlen($line);
            },
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $out = curl_exec($ch);
        if ($out === false) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new \RuntimeException($error ?: 'The request failed.');
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        return ['status' => $status, 'body' => (string) $out, 'headers' => $responseHeaders];
    }
}

/**
 * One kind of object: what you can do with it. Ids and references both work
 * wherever an id is asked for.
 */
class Resource
{
    /** @var MoneyMoves */
    private $client;
    /** @var string */
    private $path;
    /** @var string[] */
    private $allowed;

    /** @param string[] $allowed */
    public function __construct(MoneyMoves $client, string $path, array $allowed)
    {
        $this->client = $client;
        $this->path = $path;
        $this->allowed = $allowed;
    }

    private function can(string $what): void
    {
        if (!in_array($what, $this->allowed, true)) {
            throw new \BadMethodCallException(ltrim($this->path, '/') . " has no {$what}.");
        }
    }

    private function at(string $id, string $tail = ''): string
    {
        return $this->path . '/' . rawurlencode($id) . $tail;
    }

    /**
     * @param array<string, mixed> $params
     * @param array{idempotency_key?: string} $opts
     * @return array<string, mixed>
     */
    public function create(array $params, array $opts = []): array
    {
        $this->can('create');
        return $this->client->request('POST', $this->path, $params, $opts);
    }

    /** @return array<string, mixed> A single object; for balance and rates, call it with no id. */
    public function retrieve(?string $id = null): array
    {
        $this->can('retrieve');
        return $this->client->request('GET', $id === null ? $this->path : $this->at($id));
    }

    /**
     * One page: ['data' => [...], 'has_more' => bool, 'next_cursor' => ?string].
     *
     * @param array<string, mixed> $params
     * @return array<string, mixed>
     */
    public function list(array $params = []): array
    {
        $this->can('list');
        return $this->client->request('GET', $this->path . MoneyMoves::query($params));
    }

    /**
     * Every item, across all pages: foreach ($mm->payments->each(['status' => 'successful']) as $payment) { ... }
     *
     * @param array<string, mixed> $params
     * @return \Generator<int, array<string, mixed>>
     */
    public function each(array $params = []): \Generator
    {
        $this->can('each');
        return $this->client->pages($this->path, $params);
    }

    /**
     * @param array{idempotency_key?: string} $opts
     * @return array<string, mixed>
     */
    public function cancel(string $id, array $opts = []): array
    {
        $this->can('cancel');
        return $this->client->request('POST', $this->at($id, '/cancel'), null, $opts);
    }

    /** Test keys only: pretend your transfer to the refund's account landed. @return array<string, mixed> */
    public function simulate(string $id): array
    {
        $this->can('simulate');
        return $this->client->request('POST', $this->at($id, '/simulate'));
    }

    /**
     * Your reply to a dispute.
     *
     * @param array{message: string} $params
     * @param array{idempotency_key?: string} $opts
     * @return array<string, mixed>
     */
    public function reply(string $id, array $params, array $opts = []): array
    {
        $this->can('reply');
        return $this->client->request('POST', $this->at($id, '/reply'), $params, $opts);
    }

    /** Test keys only: the customer accepts your reply. @return array<string, mixed> */
    public function accept(string $id): array
    {
        $this->can('accept');
        return $this->client->request('POST', $this->at($id, '/accept'));
    }
}
