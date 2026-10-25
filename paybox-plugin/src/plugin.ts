/**
 * Money Moves for PayBox: agents that pay Nigerian businesses, and businesses
 * whose agents run their checkout.
 *
 * Paying: give it a Money Moves payment link, invoice or store address. It
 * quotes the price, opens a payment with its own Solana address, and proposes
 * the exact USDC transfer for PayBox to approve and sign. The business gets
 * naira in its bank account, settled the moment the USDC lands.
 *
 * Running a business: with the owner's Money Moves Business secret key added
 * in PayBox (a brokered Authorization header for the Money Moves host), the
 * agent makes checkouts, reads one, lists payments and checks the balance.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { atomicAmount, proposeSolana, solanaOutputSchema } from "./paybox.js";
import { BASE, MoneyMovesError, call, receiptUrl, solanaAddress, takesSolanaUsdc, targetOf, usdcTransfer, type PublicCheckout, type PublicPayment } from "./money-moves.js";
import { LOGO_DATA, LOGO_URL } from "./logo.js";

const PROTOCOL_VERSION = "2026-07-28";

const ngn = (n: number) => `₦${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A tool that failed: Money Moves's own sentence, never a stack trace. */
function failed(e: unknown) {
  const text = e instanceof MoneyMovesError ? e.message : e instanceof Error ? e.message : "Something went wrong. Try again.";
  return { isError: true, content: [{ type: "text" as const, text }] };
}

/** The merchant tools need the owner's key, which PayBox adds for the Money Moves host. */
function merchantFailed(e: unknown) {
  if (e instanceof MoneyMovesError && (e.code === "no_key" || e.code === "bad_key")) {
    return failed(new MoneyMovesError(`The merchant tools need a Money Moves Business secret key. The plugin's owner adds it in PayBox as a Secret for ${new URL(BASE).host}, header Authorization, value "Bearer sk_live_…".`, 401));
  }
  return failed(e);
}

const linkInput = z.string().min(2).max(300).describe("A Money Moves payment link, invoice or store address, like https://pay.usemoneymoves.xyz/ada-shoes, or just its name.");
const amountInput = {
  amount: z.number().positive().optional().describe("Only for a link without a set price: how much to pay."),
  currency: z.enum(["NGN", "USD"]).optional().describe("The currency of amount. Defaults to the link's own."),
};

const quoteOutput = z
  .object({
    business: z.string(),
    verified: z.boolean(),
    item: z.string(),
    kind: z.enum(["link", "invoice", "outlet"]),
    mode: z.enum(["test", "live"]),
    open: z.boolean(),
    currency: z.enum(["NGN", "USD"]),
    amount: z.number().nullable(),
    amount_ngn: z.number().nullable(),
    amount_usd: z.number().nullable(),
    rate_ngn_per_usd: z.number().nullable(),
    customer_pays_fee: z.boolean(),
    solana_usdc: z.boolean(),
    min_ngn: z.number(),
    max_ngn: z.number(),
  })
  .strict();

const paymentOutput = z
  .object({
    payment: z.string(),
    reference: z.string(),
    status: z.enum(["open", "paid", "underpaid", "expired"]),
    amount_ngn: z.number(),
    amount_usd: z.number(),
    received_ngn: z.number().nullable(),
    transaction: z.string().nullable(),
    receipt_url: z.string().nullable(),
    expires_at: z.string(),
    paid_at: z.string().nullable(),
  })
  .strict();

const STATUS = { OPEN: "open", PAID: "paid", UNDERPAID: "underpaid", EXPIRED: "expired" } as const;
const paymentShape = (p: PublicPayment) => ({
  payment: p.token,
  reference: p.ref,
  status: STATUS[p.status],
  amount_ngn: p.amountNgn,
  amount_usd: p.amountUsd,
  received_ngn: p.receivedNgn,
  transaction: p.tx,
  receipt_url: p.status === "PAID" || p.status === "UNDERPAID" ? receiptUrl(p.token) : null,
  expires_at: new Date(p.expiresAt).toISOString(),
  paid_at: p.paidAt ? new Date(p.paidAt).toISOString() : null,
});

function quoteOf(kind: "link" | "invoice" | "outlet", c: PublicCheckout) {
  const amount = c.link.amount;
  const rate = c.rate;
  const amountNgn = amount == null ? null : c.link.currency === "NGN" ? amount : rate ? Math.round(amount * rate * 100) / 100 : null;
  const amountUsd = amount == null ? null : c.link.currency === "USD" ? amount : rate ? Math.round((amount / rate) * 100) / 100 : null;
  return {
    business: c.business.name,
    verified: c.business.verified,
    item: c.link.name,
    kind,
    mode: c.link.mode === "TEST" ? ("test" as const) : ("live" as const),
    open: c.link.active && !c.maintenance,
    currency: c.link.currency,
    amount,
    amount_ngn: amountNgn,
    amount_usd: amountUsd,
    rate_ngn_per_usd: rate,
    customer_pays_fee: c.link.feePayer === "CUSTOMER",
    solana_usdc: takesSolanaUsdc(c),
    min_ngn: c.limits.minNgn,
    max_ngn: c.limits.maxNgn,
  };
}

// ─── Merchant API shapes ──────────────────────────────────────────────────

type V1Checkout = { id: string; status: string; url: string; amount: number | null; currency: string; description: string | null; reference: string | null; expires_at: string | null; created_at: string; payment: { id: string; reference: string; method: string; amount_ngn: number; paid_at: string | null; receipt_url: string | null } | null };
type V1Payment = { id: string; status: string; reference: string; method: string; currency: string; amount_ngn: number; amount_usd: number; received_ngn: number | null; checkout_reference: string | null; customer: { email: string | null; name: string | null }; receipt_url: string | null; created_at: string; paid_at: string | null };

const checkoutOutput = z
  .object({
    id: z.string(),
    status: z.string(),
    url: z.string(),
    amount: z.number().nullable(),
    currency: z.string(),
    description: z.string().nullable(),
    reference: z.string().nullable(),
    expires_at: z.string().nullable(),
    created_at: z.string(),
    payment: z.object({ id: z.string(), reference: z.string(), method: z.string(), amount_ngn: z.number(), paid_at: z.string().nullable(), receipt_url: z.string().nullable() }).strict().nullable(),
  })
  .strict();
const checkoutShape = (c: V1Checkout) => ({
  id: c.id,
  status: c.status,
  url: c.url,
  amount: c.amount,
  currency: c.currency,
  description: c.description,
  reference: c.reference,
  expires_at: c.expires_at,
  created_at: c.created_at,
  payment: c.payment ? { id: c.payment.id, reference: c.payment.reference, method: c.payment.method, amount_ngn: c.payment.amount_ngn, paid_at: c.payment.paid_at, receipt_url: c.payment.receipt_url ?? null } : null,
});

function createServer() {
  const server = new McpServer(
    {
      name: "money-moves",
      title: "Money Moves",
      version: "1.0.2",
      websiteUrl: "https://usemoneymoves.xyz",
      icons: [
        { src: LOGO_URL, mimeType: "image/png", sizes: ["180x180"] },
        { src: LOGO_DATA, mimeType: "image/png", sizes: ["180x180"] },
      ],
    },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  // ─── Paying a business ─────────────────────────────────────────────────

  server.registerTool(
    "money_moves_options",
    {
      title: "What Money Moves takes",
      description: "Read-only. The ways Nigerian businesses on Money Moves can be paid right now (bank transfer, the Money Moves app, crypto networks), the processing fees and the payment limits.",
      inputSchema: z.object({}).strict(),
      outputSchema: z
        .object({
          naira_transfer: z.boolean(),
          money_moves_app: z.boolean(),
          crypto: z.boolean(),
          crypto_networks: z.array(z.string()),
          crypto_fee_percent: z.number(),
          crypto_fee_cap_usd: z.number(),
          min_ngn: z.number(),
          max_ngn: z.number(),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const c = await call<{ platform: { fees: { cryptoRateBps: number; cryptoCapUsd: number }; limits: { businessMinNgn: number; businessMaxNgn: number } }; live: { naira: boolean; app: boolean; crypto: boolean; cryptoNetworks: string[] } }>("GET", "/config");
        const out = {
          naira_transfer: c.live.naira,
          money_moves_app: c.live.app,
          crypto: c.live.crypto,
          crypto_networks: c.live.cryptoNetworks,
          crypto_fee_percent: c.platform.fees.cryptoRateBps / 100,
          crypto_fee_cap_usd: c.platform.fees.cryptoCapUsd,
          min_ngn: c.platform.limits.businessMinNgn,
          max_ngn: c.platform.limits.businessMaxNgn,
        };
        const text = `Money Moves takes ${[out.naira_transfer && "bank transfers", out.money_moves_app && "the Money Moves app", out.crypto && `crypto on ${out.crypto_networks.join(", ")}`].filter(Boolean).join(", ")}. Payments from ${ngn(out.min_ngn)} to ${ngn(out.max_ngn)}. Through PayBox, pay with USDC on Solana.`;
        return { content: [{ type: "text" as const, text }], structuredContent: out };
      } catch (e) {
        return failed(e);
      }
    },
  );

  server.registerTool(
    "quote_business_payment",
    {
      title: "Quote a Money Moves payment",
      description: "Read-only. Looks up a Money Moves payment link, invoice or store address: which business, what for, how much in naira and dollars, and whether it can be paid with USDC on Solana. Nothing is opened or paid.",
      inputSchema: z.object({ link: linkInput }).strict(),
      outputSchema: quoteOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ link }) => {
      try {
        const t = targetOf(link);
        const q = quoteOf(t.kind, await call<PublicCheckout>("GET", t.api));
        const price = q.amount == null ? "any amount you choose" : `${q.currency === "NGN" ? ngn(q.amount) : usd(q.amount)}${q.amount_usd != null && q.currency === "NGN" ? ` (about ${usd(q.amount_usd)})` : ""}`;
        const state = !q.open ? " It isn't taking payments right now." : q.mode === "test" ? " It's a test checkout: only its page's test buttons can pay it." : q.solana_usdc ? " It takes USDC on Solana." : " It doesn't take USDC on Solana.";
        return { content: [{ type: "text" as const, text: `${q.business}${q.verified ? " (verified)" : ""}: ${q.item}, ${price}.${state}` }], structuredContent: q };
      } catch (e) {
        return failed(e);
      }
    },
  );

  server.registerTool(
    "pay_business_with_solana_usdc",
    {
      title: "Pay a Nigerian business with USDC on Solana",
      description:
        "Opens a payment on a Money Moves payment link, invoice or store address and proposes the exact USDC transfer on Solana from the user's wallet to that payment's own address. PayBox shows it for approval and signs it; nothing moves until the user approves. The business gets naira in its bank account once it lands. Use quote_business_payment first. Then follow it with payment_status.",
      inputSchema: z
        .object({
          link: linkInput,
          sender: z.string().min(32).max(44).describe("The public address of the user's Solana wallet that will pay."),
          email: z.string().email().max(254).describe("Where the receipt goes: the user's email."),
          name: z.string().min(2).max(80).optional().describe("The payer's name, as the business sees it."),
          phone: z.string().min(7).max(30).optional().describe("Only when the business asks for a phone number."),
          ...amountInput,
        })
        .strict(),
      outputSchema: solanaOutputSchema.extend({ payment: paymentOutput, send: z.object({ coin: z.literal("USDC"), network: z.literal("Solana"), amount: z.string(), to: z.string() }).strict() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ link, sender, email, name, phone, amount, currency }) => {
      try {
        const from = solanaAddress(sender, "sender");
        const t = targetOf(link);
        // Straight to opening it: one request fits the sandbox's time. Money Moves itself refuses a closed
        // checkout, a missing amount or phone, and a coin it doesn't take, each in a sentence.
        const opened = await call<{ payment: PublicPayment }>(
          "POST",
          `${t.api}/crypto`,
          { coin: "USDC", network: "Solana", email, ...(name ? { name } : {}), ...(phone ? { phone } : {}), ...(amount != null ? { amount, ...(currency ? { currency } : {}) } : {}) },
          8_500,
        );
        const p = opened.payment;
        if (p.mode === "TEST") throw new MoneyMovesError("That's a test checkout. It can't receive real money; only the test buttons on its page can pay it.", 400, "test_checkout");
        const d = p.deposit;
        if (!d?.address || !d.amount || d.network !== "Solana" || d.coin !== "USDC") throw new MoneyMovesError("Money Moves didn't give a Solana USDC address for this payment. Try again.", 502, "no_address");
        const to = solanaAddress(d.address, "The payment's address");
        const atomic = atomicAmount(d.amount, 6);
        const proposal = proposeSolana({ transactionBase64: usdcTransfer(from, to, BigInt(atomic)) });
        const fee = p.customerFeeNgn ? `, including a ${ngn(p.customerFeeNgn)} processing fee` : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `Payment ${p.ref} is open: send ${d.amount} USDC on Solana (${ngn(p.amountNgn)}${fee}). Approve the transfer in PayBox before ${new Date(p.expiresAt).toISOString()}. Then call payment_status with payment "${p.token}". Nothing has been signed or paid yet.`,
            },
          ],
          structuredContent: { ...proposal.structuredContent, payment: paymentShape(p), send: { coin: "USDC" as const, network: "Solana" as const, amount: d.amount, to: d.address } },
        };
      } catch (e) {
        return failed(e);
      }
    },
  );

  server.registerTool(
    "payment_status",
    {
      title: "Check a Money Moves payment",
      description: "Read-only. Whether a payment opened with pay_business_with_solana_usdc has arrived: open, paid, underpaid or expired, the transaction once it's on chain, and the receipt link once it's paid.",
      inputSchema: z.object({ payment: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).describe("The payment value pay_business_with_solana_usdc returned.") }).strict(),
      outputSchema: paymentOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ payment }) => {
      try {
        const { payment: p } = await call<{ payment: PublicPayment }>("GET", `/pay/p/${payment}`, undefined, 6_000);
        const out = paymentShape(p);
        const text =
          out.status === "paid"
            ? `Paid. ${ngn(p.receivedNgn ?? p.amountNgn)} reached the business. Receipt: ${out.receipt_url}`
            : out.status === "underpaid"
              ? `Less than the amount arrived (${p.deposit?.received ?? "part"} USDC). Send the rest: ${p.deposit?.left ?? "the difference"} USDC.`
              : out.status === "expired"
                ? "This payment closed with nothing received."
                : p.deposit?.received
                  ? `Part arrived: ${p.deposit.received} USDC. ${p.deposit.left} USDC still to send.`
                  : "Waiting for the USDC to land. Solana usually takes a few seconds.";
        return { content: [{ type: "text" as const, text }], structuredContent: out };
      } catch (e) {
        return failed(e);
      }
    },
  );

  // ─── Running the business (owner's key) ────────────────────────────────

  server.registerTool(
    "create_checkout",
    {
      title: "Make a Money Moves checkout",
      description: "For the business that owns this plugin's key: makes a checkout for one amount and returns its link to send a customer. They can pay by bank transfer, the Money Moves app or crypto, and the business is settled in naira.",
      inputSchema: z
        .object({
          amount: z.number().positive().describe("How much, in currency."),
          currency: z.enum(["NGN", "USD"]),
          description: z.string().max(200).optional().describe("What it's for, shown to the customer."),
          reference: z.string().max(100).optional().describe("Your own reference, like an order number."),
          customer_email: z.string().email().max(200).optional(),
          customer_name: z.string().max(100).optional(),
          expires_in_minutes: z.number().int().min(5).max(43_200).optional().describe("Close it after this many minutes. Left out: it stays open."),
        })
        .strict(),
      outputSchema: checkoutOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (a) => {
      try {
        const c = await call<V1Checkout>(
          "POST",
          "/v1/checkouts",
          {
            amount: a.amount,
            currency: a.currency,
            ...(a.description ? { description: a.description } : {}),
            ...(a.reference ? { reference: a.reference } : {}),
            ...(a.customer_email || a.customer_name ? { customer: { ...(a.customer_email ? { email: a.customer_email } : {}), ...(a.customer_name ? { name: a.customer_name } : {}) } } : {}),
            ...(a.expires_in_minutes ? { expires_in: a.expires_in_minutes * 60 } : {}),
          },
          6_000,
        );
        return { content: [{ type: "text" as const, text: `Checkout ready: ${c.url} for ${c.currency === "NGN" ? ngn(c.amount ?? 0) : usd(c.amount ?? 0)}.` }], structuredContent: checkoutShape(c) };
      } catch (e) {
        return merchantFailed(e);
      }
    },
  );

  server.registerTool(
    "get_checkout",
    {
      title: "Read a Money Moves checkout",
      description: "For the business that owns this plugin's key: whether a checkout is open, paid, expired or cancelled, and its payment once it's paid.",
      inputSchema: z.object({ id: z.string().min(5).max(64).regex(/^[A-Za-z0-9_-]+$/) }).strict(),
      outputSchema: checkoutOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      try {
        const c = await call<V1Checkout>("GET", `/v1/checkouts/${id}`);
        return { content: [{ type: "text" as const, text: `Checkout ${c.id} is ${c.status}${c.payment ? `, paid ${ngn(c.payment.amount_ngn)} by ${c.payment.method.replace("_", " ")}${c.payment.receipt_url ? `. Receipt: ${c.payment.receipt_url}` : ""}` : ""}.` }], structuredContent: checkoutShape(c) };
      } catch (e) {
        return merchantFailed(e);
      }
    },
  );

  server.registerTool(
    "list_payments",
    {
      title: "List Money Moves payments",
      description: "For the business that owns this plugin's key: its latest payments, from checkouts, payment links, invoices and store QRs, newest first.",
      inputSchema: z.object({ status: z.enum(["open", "successful", "underpaid", "expired"]).optional(), limit: z.number().int().min(1).max(50).optional() }).strict(),
      outputSchema: z
        .object({
          payments: z.array(
            z
              .object({
                id: z.string(),
                reference: z.string(),
                status: z.string(),
                method: z.string(),
                amount_ngn: z.number(),
                amount_usd: z.number(),
                received_ngn: z.number().nullable(),
                order_reference: z.string().nullable(),
                customer: z.string().nullable(),
                receipt_url: z.string().nullable(),
                created_at: z.string(),
                paid_at: z.string().nullable(),
              })
              .strict(),
          ),
          has_more: z.boolean(),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ status, limit }) => {
      try {
        const q = new URLSearchParams({ limit: String(limit ?? 10), ...(status ? { status } : {}) });
        const r = await call<{ data: V1Payment[]; has_more: boolean }>("GET", `/v1/payments?${q}`);
        const payments = r.data.map((p) => ({
          id: p.id,
          reference: p.reference,
          status: p.status,
          method: p.method,
          amount_ngn: p.amount_ngn,
          amount_usd: p.amount_usd,
          received_ngn: p.received_ngn,
          order_reference: p.checkout_reference,
          customer: p.customer.name ?? p.customer.email,
          receipt_url: p.receipt_url ?? null,
          created_at: p.created_at,
          paid_at: p.paid_at,
        }));
        const paid = payments.filter((p) => p.status === "successful");
        const text = payments.length
          ? `${payments.length} payment${payments.length === 1 ? "" : "s"}${paid.length ? `, ${paid.length} successful for ${ngn(paid.reduce((s, p) => s + (p.received_ngn ?? p.amount_ngn), 0))}` : ""}.`
          : "No payments yet.";
        return { content: [{ type: "text" as const, text }], structuredContent: { payments, has_more: r.has_more } };
      } catch (e) {
        return merchantFailed(e);
      }
    },
  );

  server.registerTool(
    "get_balance",
    {
      title: "Money Moves balance",
      description: "For the business that owns this plugin's key: money on its way to where it settles, what its business wallet holds on each chain, and today's naira rate.",
      inputSchema: z.object({}).strict(),
      outputSchema: z
        .object({
          settling_ngn: z.number(),
          settling_count: z.number(),
          wallet_usd: z.number().nullable(),
          wallet_ngn: z.number().nullable(),
          holdings: z.array(z.object({ coin: z.string(), network: z.string(), amount: z.number() }).strict()),
          rate_ngn_per_usd: z.number().nullable(),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const b = await call<{ settling: { amount_ngn: number; count: number }; wallet: { holdings: { coin: string; network: string; amount: number }[]; total_usd: number | null; total_ngn: number | null } | null; rate_ngn_per_usd: number | null }>("GET", "/v1/balance", undefined, 8_000);
        const out = {
          settling_ngn: b.settling.amount_ngn,
          settling_count: b.settling.count,
          wallet_usd: b.wallet?.total_usd ?? null,
          wallet_ngn: b.wallet?.total_ngn ?? null,
          holdings: b.wallet?.holdings ?? [],
          rate_ngn_per_usd: b.rate_ngn_per_usd,
        };
        const text = `${ngn(out.settling_ngn)} on its way in ${out.settling_count} settlement${out.settling_count === 1 ? "" : "s"}.${out.wallet_usd != null ? ` Business wallet: ${usd(out.wallet_usd)}${out.wallet_ngn != null ? ` (${ngn(out.wallet_ngn)})` : ""}.` : ""}`;
        return { content: [{ type: "text" as const, text }], structuredContent: out };
      } catch (e) {
        return merchantFailed(e);
      }
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
