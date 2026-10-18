/**
 * The Money Moves Business SDK for Node.js.
 *
 *   import { MoneyMoves } from "@moneymoves/sdk";
 *   const mm = new MoneyMoves(process.env.MONEYMOVES_SECRET_KEY);
 *   const checkout = await mm.checkouts.create({ amount: 5000, currency: "NGN" }, { idempotencyKey: "order_1042" });
 *
 * No runtime dependencies. Reads are retried on network errors, 429s and 5xx.
 * Writes are sent once, unless you give an idempotency key: if a write's
 * response is lost, you get a MoneyMovesConnectionError saying the outcome is
 * unknown, so you can check before trying again.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  Account,
  Balance,
  Checkout,
  CheckoutCreateParams,
  CheckoutListParams,
  Dispute,
  DisputeCreateParams,
  DisputeListParams,
  DisputeReplyParams,
  Event,
  EventListParams,
  List,
  Payment,
  PaymentListParams,
  Rate,
  Refund,
  RefundCreateParams,
  RefundListParams,
  RequestOptions,
  Settlement,
  SettlementListParams,
} from './types.js'

export type * from './types.js'

export const VERSION = '1.1.0'
const DEFAULT_BASE = 'https://business.usemoneymoves.xyz/api/v1'

export interface MoneyMovesOptions {
  /** Your secret key, sk_test_… or sk_live_…. Defaults to MONEYMOVES_SECRET_KEY. */
  apiKey?: string
  /** Defaults to the production API. */
  baseUrl?: string
  /** How long to wait for each response. Default 30 seconds. */
  timeoutMs?: number
  /** How many times a read (or a write with an idempotency key) is retried. Default 2. */
  maxRetries?: number
  /** Your own fetch, for tests or proxies. Defaults to the global fetch. */
  fetch?: typeof fetch
}

/* ─── Errors ───────────────────────────────────────────────────────── */

/** An error the API returned: its HTTP status, its code, and the request id to quote to support. */
export class MoneyMovesError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string | null
  constructor(message: string, status: number, code: string, requestId: string | null) {
    super(message)
    this.name = 'MoneyMovesError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

/** The request didn't get an answer. For a write without an idempotency key, it may or may not have happened. */
export class MoneyMovesConnectionError extends MoneyMovesError {
  readonly outcomeUnknown: boolean
  constructor(message: string, outcomeUnknown: boolean) {
    super(message, 0, 'connection_error', null)
    this.name = 'MoneyMovesConnectionError'
    this.outcomeUnknown = outcomeUnknown
  }
}

/** A webhook whose signature didn't check out. */
export class MoneyMovesSignatureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoneyMovesSignatureError'
  }
}

/* ─── The client ───────────────────────────────────────────────────── */

type Query = Record<string, string | number | boolean | Date | undefined>

const qs = (q?: Query) => {
  if (!q) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined) p.set(k, v instanceof Date ? v.toISOString() : String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const id = (v: string) => encodeURIComponent(v)

export class MoneyMoves {
  private readonly key: string
  private readonly base: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly fetchFn: typeof fetch

  constructor(apiKey?: string | MoneyMovesOptions, options: MoneyMovesOptions = {}) {
    const o = typeof apiKey === 'object' ? apiKey : { ...options, apiKey }
    const key = o.apiKey ?? (typeof process !== 'undefined' ? process.env.MONEYMOVES_SECRET_KEY : undefined)
    if (!key || !/^sk_(test|live)_/.test(key)) throw new Error('Pass your secret key (sk_test_… or sk_live_…), or set MONEYMOVES_SECRET_KEY.')
    this.key = key
    this.base = (o.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '')
    this.timeoutMs = o.timeoutMs ?? 30_000
    this.maxRetries = o.maxRetries ?? 2
    const f = o.fetch ?? globalThis.fetch
    if (!f) throw new Error('No fetch available. Use Node.js 18 or later, or pass one in.')
    this.fetchFn = f
  }

  /** The mode this key works in. */
  get mode(): 'test' | 'live' {
    return this.key.startsWith('sk_live_') ? 'live' : 'test'
  }

  /** One request, with retries where they're safe. */
  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    const retryable = method === 'GET' || !!opts.idempotencyKey
    const tries = retryable ? this.maxRetries + 1 : 1
    let last: unknown
    for (let attempt = 0; attempt < tries; attempt++) {
      if (attempt > 0) await sleep(Math.min(2000, 300 * 2 ** (attempt - 1)) + Math.random() * 100)
      let res: Response
      try {
        res = await this.fetchFn(`${this.base}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.key}`,
            accept: 'application/json',
            'user-agent': `moneymoves-node/${VERSION}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        })
      } catch (e) {
        last = e
        continue
      }
      const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; request_id?: string } } | null
      if (res.ok) return json as T
      const err = new MoneyMovesError(json?.error?.message ?? `Money Moves answered ${res.status}.`, res.status, json?.error?.code ?? 'error', json?.error?.request_id ?? res.headers.get('mm-request-id'))
      // A first try still running under the same idempotency key: wait for it, then ask again.
      const stillRunning = res.status === 409 && err.code === 'idempotency_in_progress'
      if (retryable && (res.status === 429 || res.status >= 500 || stillRunning) && attempt < tries - 1) {
        last = err
        continue
      }
      throw err
    }
    if (last instanceof MoneyMovesError) throw last
    throw new MoneyMovesConnectionError(
      retryable
        ? `Couldn't reach Money Moves after ${tries} tries. ${last instanceof Error ? last.message : ''}`.trim()
        : `No answer from Money Moves, so this ${method} may or may not have gone through. Check before trying again, or send an idempotency key so retries are safe.`,
      !retryable,
    )
  }

  /** Every item across every page, fetched as you go. */
  private async *pages<T extends { id: string }>(path: string, params: Query = {}): AsyncGenerator<T> {
    let after = params.starting_after as string | undefined
    for (;;) {
      const page = await this.request<List<T>>('GET', `${path}${qs({ ...params, starting_after: after })}`)
      for (const item of page.data) yield item
      if (!page.has_more || !page.next_cursor) return
      after = page.next_cursor
    }
  }

  readonly account = {
    /** Whose key this is. */
    retrieve: () => this.request<Account>('GET', '/account'),
  }

  readonly checkouts = {
    create: (params: CheckoutCreateParams, opts?: RequestOptions) => this.request<Checkout>('POST', '/checkouts', params, opts),
    retrieve: (checkoutId: string) => this.request<Checkout>('GET', `/checkouts/${id(checkoutId)}`),
    list: (params?: CheckoutListParams) => this.request<List<Checkout>>('GET', `/checkouts${qs(params as Query)}`),
    each: (params?: CheckoutListParams) => this.pages<Checkout>('/checkouts', params as Query),
    cancel: (checkoutId: string, opts?: RequestOptions) => this.request<Checkout>('POST', `/checkouts/${id(checkoutId)}/cancel`, undefined, opts),
  }

  readonly payments = {
    /** By id, or by the reference on the customer's receipt. */
    retrieve: (idOrReference: string) => this.request<Payment>('GET', `/payments/${id(idOrReference)}`),
    list: (params?: PaymentListParams) => this.request<List<Payment>>('GET', `/payments${qs(params as Query)}`),
    each: (params?: PaymentListParams) => this.pages<Payment>('/payments', params as Query),
  }

  readonly settlements = {
    retrieve: (idOrReference: string) => this.request<Settlement>('GET', `/settlements/${id(idOrReference)}`),
    list: (params?: SettlementListParams) => this.request<List<Settlement>>('GET', `/settlements${qs(params as Query)}`),
    each: (params?: SettlementListParams) => this.pages<Settlement>('/settlements', params as Query),
  }

  readonly refunds = {
    create: (params: RefundCreateParams, opts?: RequestOptions) => this.request<Refund>('POST', '/refunds', params, opts),
    retrieve: (idOrReference: string) => this.request<Refund>('GET', `/refunds/${id(idOrReference)}`),
    list: (params?: RefundListParams) => this.request<List<Refund>>('GET', `/refunds${qs(params as Query)}`),
    each: (params?: RefundListParams) => this.pages<Refund>('/refunds', params as Query),
    cancel: (refundId: string, opts?: RequestOptions) => this.request<Refund>('POST', `/refunds/${id(refundId)}/cancel`, undefined, opts),
    /** Test keys only: pretend your transfer to the refund's account landed. */
    simulate: (refundId: string) => this.request<Refund>('POST', `/refunds/${id(refundId)}/simulate`),
  }

  readonly disputes = {
    /** By id, or by its MMBD- reference. Comes with its whole conversation. */
    retrieve: (idOrReference: string) => this.request<Dispute>('GET', `/disputes/${id(idOrReference)}`),
    list: (params?: DisputeListParams) => this.request<List<Dispute>>('GET', `/disputes${qs(params as Query)}`),
    each: (params?: DisputeListParams) => this.pages<Dispute>('/disputes', params as Query),
    /** Your reply. A customer then has 3 days to accept or answer; a bank claim goes to the bank. */
    reply: (disputeId: string, params: DisputeReplyParams, opts?: RequestOptions) => this.request<Dispute>('POST', `/disputes/${id(disputeId)}/reply`, params, opts),
    /** Test keys only: open a dispute on a paid test payment, as its customer would. */
    create: (params: DisputeCreateParams, opts?: RequestOptions) => this.request<Dispute>('POST', '/disputes', params, opts),
    /** Test keys only: the customer accepts your reply. */
    accept: (disputeId: string) => this.request<Dispute>('POST', `/disputes/${id(disputeId)}/accept`),
  }

  readonly balance = {
    retrieve: () => this.request<Balance>('GET', '/balance'),
  }

  readonly rates = {
    retrieve: () => this.request<Rate>('GET', '/rates'),
  }

  readonly events = {
    retrieve: (eventId: string) => this.request<Event>('GET', `/events/${id(eventId)}`),
    list: (params?: EventListParams) => this.request<List<Event>>('GET', `/events${qs(params as Query)}`),
    each: (params?: EventListParams) => this.pages<Event>('/events', params as Query),
  }

  /** Checking the webhooks Money Moves sends you. */
  readonly webhooks = webhooks
}

/* ─── Webhooks ─────────────────────────────────────────────────────── */

export const webhooks = {
  /**
   * Checks a webhook's mm-signature header against the raw body and your
   * signing secret, and returns the event. Throws MoneyMovesSignatureError if
   * it doesn't match, or if it was signed more than `toleranceSeconds` ago.
   * Pass the body exactly as it arrived: a string or a Buffer, before any JSON parsing.
   */
  constructEvent<T = unknown>(payload: string | Uint8Array, signatureHeader: string | null | undefined, secret: string, toleranceSeconds = 300): Event<T> {
    const raw = typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8')
    if (!signatureHeader) throw new MoneyMovesSignatureError('No mm-signature header.')
    const parts = Object.fromEntries(
      signatureHeader.split(',').map((p) => {
        const at = p.indexOf('=')
        return [p.slice(0, at).trim(), p.slice(at + 1).trim()]
      }),
    )
    const t = Number(parts.t)
    if (!parts.t || !parts.v1 || !Number.isFinite(t)) throw new MoneyMovesSignatureError('The mm-signature header is malformed.')
    if (toleranceSeconds > 0 && Math.abs(Date.now() / 1000 - t) > toleranceSeconds) throw new MoneyMovesSignatureError('The event was signed too long ago.')
    const expected = createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(parts.v1)
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new MoneyMovesSignatureError("The signature doesn't match. Check you're using the signing secret for this mode, and the raw body.")
    return JSON.parse(raw) as Event<T>
  },

  /** Signs a body the way Money Moves does: for testing your own webhook handler. */
  sign(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
    return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`
  },
}

export default MoneyMoves
