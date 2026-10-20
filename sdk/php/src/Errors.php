<?php

declare(strict_types=1);

namespace MoneyMoves;

/** An error the API returned: its HTTP status, its code, and the request id to quote to support. */
class MoneyMovesException extends \RuntimeException
{
    /** @var int */
    public $status;
    /** @var string */
    public $errorCode;
    /** @var string|null */
    public $requestId;

    public function __construct(string $message, int $status, string $errorCode, ?string $requestId = null)
    {
        parent::__construct($message, $status);
        $this->status = $status;
        $this->errorCode = $errorCode;
        $this->requestId = $requestId;
    }
}

/** The request didn't get an answer. For a write without an idempotency key, it may or may not have happened. */
class ConnectionException extends MoneyMovesException
{
    /** @var bool */
    public $outcomeUnknown;

    public function __construct(string $message, bool $outcomeUnknown)
    {
        parent::__construct($message, 0, 'connection_error', null);
        $this->outcomeUnknown = $outcomeUnknown;
    }
}

/** A webhook whose signature didn't check out. */
class SignatureException extends \RuntimeException
{
}
