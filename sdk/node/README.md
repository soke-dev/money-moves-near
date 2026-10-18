# @moneymoves/sdk

The official Node.js SDK for the Money Moves Business API. Typed objects, lists you can loop over, safe retries, and a one-line webhook signature check. Node.js 18 or later, no runtime dependencies, works with `import` and `require`.

Full docs: https://docs.usemoneymoves.xyz/sdk

## Install

```bash
npm install @moneymoves/sdk
```

## Use

```js
import { MoneyMoves } from "@moneymoves/sdk";

const mm = new MoneyMoves(process.env.MONEYMOVES_SECRET_KEY);

const checkout = await mm.checkouts.create(
  { amount: 5000, currency: "NGN", reference: "order_1042" },
  { idempotencyKey: "order_1042" },
);
// Send the customer to checkout.url

for await (const payment of mm.payments.each({ status: "successful" })) {
  console.log(payment.reference, payment.amount_ngn);
}
```

## Webhooks

```js
import express from "express";
import { webhooks } from "@moneymoves/sdk";

app.post("/webhooks/money-moves", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = webhooks.constructEvent(req.body, req.get("mm-signature"), process.env.MONEYMOVES_WEBHOOK_SECRET);
  } catch {
    return res.sendStatus(400);
  }
  res.sendStatus(200);
  // handle event.type
});
```

`webhooks.sign(body, secret)` makes a valid header for testing your handler.

## Errors and retries

API errors throw `MoneyMovesError` with `status`, `code`, `message` and `requestId`.

Reads are retried twice on network errors, 429s and 5xx. Writes are sent once: if one gets no answer, you get a `MoneyMovesConnectionError` with `outcomeUnknown: true`. Pass an `idempotencyKey` and a write is retried safely.

## Options

```js
new MoneyMoves(key, { timeoutMs: 30000, maxRetries: 2, baseUrl, fetch });
```

## License

MIT
