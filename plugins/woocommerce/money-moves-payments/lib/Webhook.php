<?php

declare(strict_types=1);

namespace MoneyMoves;

require_once __DIR__ . '/Errors.php';

/** Checking the webhooks Money Moves sends you. */
class Webhook
{
    /**
     * Checks a webhook's mm-signature header against the raw body and your
     * signing secret, and returns the event. Throws SignatureException if it
     * doesn't match, or if it was signed more than $toleranceSeconds ago.
     * Pass the body exactly as it arrived: file_get_contents('php://input').
     *
     * @return array<string, mixed>
     */
    public function constructEvent(string $payload, ?string $signatureHeader, string $secret, int $toleranceSeconds = 300): array
    {
        if (!$signatureHeader) {
            throw new SignatureException('No mm-signature header.');
        }
        $parts = [];
        foreach (explode(',', $signatureHeader) as $piece) {
            $at = strpos($piece, '=');
            if ($at !== false) {
                $parts[trim(substr($piece, 0, $at))] = trim(substr($piece, $at + 1));
            }
        }
        if (empty($parts['t']) || empty($parts['v1']) || !ctype_digit($parts['t'])) {
            throw new SignatureException('The mm-signature header is malformed.');
        }
        if ($toleranceSeconds > 0 && abs(time() - (int) $parts['t']) > $toleranceSeconds) {
            throw new SignatureException('The event was signed too long ago.');
        }
        $expected = hash_hmac('sha256', $parts['t'] . '.' . $payload, $secret);
        if (!hash_equals($expected, $parts['v1'])) {
            throw new SignatureException("The signature doesn't match. Check you're using the signing secret for this mode, and the raw body.");
        }
        $event = json_decode($payload, true);
        if (!is_array($event)) {
            throw new SignatureException('The body is not JSON.');
        }
        return $event;
    }

    /** Signs a body the way Money Moves does: for testing your own webhook handler. */
    public function sign(string $payload, string $secret, ?int $timestamp = null): string
    {
        $t = $timestamp ?? time();
        return 't=' . $t . ',v1=' . hash_hmac('sha256', $t . '.' . $payload, $secret);
    }
}
