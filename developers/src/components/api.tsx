/**
 * One request, written three ways - cURL, Node.js and Python - from a single
 * method, path and body, so every example on the site says the same thing.
 * The sample objects below are exactly what the API returns.
 */
import { API_BASE } from '@/nav'
import { Code, type Snippet } from './docs'

const indent = (s: string, by: string) => s.replace(/\n/g, `\n${by}`)

function toPython(v: unknown, depth = 0): string {
  const pad = '    '.repeat(depth + 1)
  const end = '    '.repeat(depth)
  if (v === null) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.length === 0 ? '[]' : `[${v.map((x) => toPython(x, depth + 1)).join(', ')}]`
  const entries = Object.entries(v as Record<string, unknown>)
  if (entries.length === 0) return '{}'
  return `{\n${entries.map(([k, x]) => `${pad}${JSON.stringify(k)}: ${toPython(x, depth + 1)},`).join('\n')}\n${end}}`
}

export function request(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, opts?: { idempotent?: boolean }): Snippet[] {
  const url = `${API_BASE}${path}`
  const json = body ? JSON.stringify(body, null, 2) : ''
  const idem = opts?.idempotent && method === 'POST'
  const curl = [
    `curl${method === 'GET' ? '' : ` -X ${method}`} ${url} \\`,
    `  -H "Authorization: Bearer $MONEYMOVES_SECRET_KEY"${body || idem ? ' \\' : ''}`,
    ...(idem ? [`  -H "Idempotency-Key: $(uuidgen)"${body ? ' \\' : ''}`] : []),
    ...(body ? [`  -H "Content-Type: application/json" \\`, `  -d '${indent(json, '  ')}'`] : []),
  ].join('\n')
  const node = `const res = await fetch("${url}", {
  method: "${method}",
  headers: {
    Authorization: \`Bearer \${process.env.MONEYMOVES_SECRET_KEY}\`,${idem ? '\n    "Idempotency-Key": crypto.randomUUID(),' : ''}${body ? '\n    "Content-Type": "application/json",' : ''}
  },${body ? `\n  body: JSON.stringify(${indent(json, '  ')}),` : ''}
});
const data = await res.json();`
  const py = `import os${idem ? ', uuid' : ''}, requests

res = requests.${method.toLowerCase()}(
    "${url}",
    headers={
        "Authorization": f"Bearer {os.environ['MONEYMOVES_SECRET_KEY']}",${idem ? '\n        "Idempotency-Key": str(uuid.uuid4()),' : ''}
    },${body ? `\n    json=${indent(toPython(body, 1), '')},` : ''}
)
data = res.json()`
  return [
    { label: 'cURL', lang: 'bash', code: curl },
    { label: 'Node.js', lang: 'js', code: node },
    { label: 'Python', lang: 'python', code: py },
  ]
}

export function Request({ method, path, body, idempotent }: { method: 'GET' | 'POST'; path: string; body?: Record<string, unknown>; idempotent?: boolean }) {
  return <Code tabs={request(method, path, body, { idempotent })} />
}

export function Response({ data, status = 200 }: { data: unknown; status?: number }) {
  return <Code title={`Response · ${status}`} tabs={[{ label: 'JSON', lang: 'json', code: JSON.stringify(data, null, 2) }]} />
}

/* ─── Sample objects, shared across pages ──────────────────────────── */

export const PAYMENT = {
  id: 'cmvd2k9x40001mk30q7h2a1bc',
  object: 'payment',
  mode: 'live',
  status: 'successful',
  reference: 'MMB-9DQMDUNU',
  checkout: 'cmvcmijdb000gob30t89lhukg',
  invoice: null,
  outlet: null,
  checkout_reference: 'order_1042',
  metadata: { order_id: '1042' },
  currency: 'NGN',
  amount_ngn: 5000,
  amount_usd: 3.68,
  customer_fee_ngn: null,
  fee_ngn: 12.5,
  received_ngn: 5000,
  rate_ngn_per_usd: 1358.28,
  method: 'crypto',
  crypto: { coin: 'USDC', network: 'Solana', address: '4cFtpRDoyuL1atELaTF8BazCV1F8YuubPm5p2VxBxPh1', memo: null, transaction: '3Pxywdweu29iQKL7f8WJTHioPYAkFpj2hER4mn1g5SN7…' },
  customer: { email: 'ada@example.com', name: 'Ada Okafor', phone: null },
  payer: { name: null, bank: null, account: '8PRry1khFVwSGPEPLSFU5EaZ5gknJUr7zh1grvZFLZgh' },
  receipt_url: 'https://business.usemoneymoves.xyz/pay/r/No30KFczF6C2l_dh8PsbAuH0',
  created_at: '2026-10-17T17:39:58.000Z',
  paid_at: '2026-10-17T17:40:51.000Z',
  expires_at: '2026-10-17T18:09:58.000Z',
}

export const CHECKOUT = {
  id: 'cmvcmijdb000gob30t89lhukg',
  object: 'checkout',
  mode: 'live',
  status: 'open',
  url: 'https://pay.usemoneymoves.xyz/co-a70cfb772b66',
  amount: 5000,
  currency: 'NGN',
  description: 'Two shirts',
  reference: 'order_1042',
  metadata: { order_id: '1042' },
  methods: ['bank_transfer', 'app', 'crypto'],
  customer: { email: 'ada@example.com', name: 'Ada Okafor' },
  fee_payer: null,
  redirect_url: 'https://yourshop.com/orders/1042/thanks',
  payment: null,
  expires_at: '2026-10-17T18:39:13.000Z',
  created_at: '2026-10-17T16:41:13.103Z',
}

export const SETTLEMENT = {
  id: 'cmvd2kc1q0003mk30xq2rk9d1',
  object: 'settlement',
  mode: 'live',
  status: 'completed',
  reference: 'MMBS8YPQFSK6PXMW',
  payment: 'cmvd2k9x40001mk30q7h2a1bc',
  payment_reference: 'MMB-9DQMDUNU',
  destination: 'bank',
  amount_ngn: 4987.5,
  fee_ngn: 12.5,
  bank: { name: 'Opay', account_number: '8161859340', account_name: 'MOVERS TECH LTD' },
  crypto: null,
  created_at: '2026-10-17T17:40:53.000Z',
  completed_at: '2026-10-17T17:40:58.000Z',
}

export const REFUND = {
  id: 'cmvd3a7m20009mk30b1c8zq4e',
  object: 'refund',
  mode: 'live',
  status: 'awaiting_funds',
  reference: 'RF-7K2Q9P',
  payment: 'cmvd2k9x40001mk30q7h2a1bc',
  amount_ngn: 1000,
  amount_usd: 0.74,
  funding: {
    method: 'bank_transfer',
    amount_ngn: 997.5,
    fee_returned_ngn: 2.5,
    bank: { name: 'Wema Bank', account_number: '7821940032', account_name: 'Movers Tech LTD refund', expires_at: '2026-10-17T19:10:00.000Z' },
    funded_at: null,
  },
  to: { kind: 'wallet', name: null, bank: null, account: '8PRry1khFVwSGPEPLSFU5EaZ5gknJUr7zh1grvZFLZgh', coin: 'USDC', network: 'Solana' },
  reason: 'One shirt back',
  created_at: '2026-10-17T18:40:00.000Z',
  completed_at: null,
}

export const EVENT = {
  id: 'evt_q8Lr2mX0aT9vKc1Yp3Nw',
  object: 'event',
  type: 'payment.successful',
  mode: 'live',
  created_at: '2026-10-17T17:40:52.000Z',
  data: { object: PAYMENT },
}

export const list = (item: unknown) => ({ object: 'list', data: [item], has_more: true, next_cursor: (item as { id: string }).id })
