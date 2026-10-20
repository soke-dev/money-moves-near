/**
 * The docs' map: four tabs, each a list of groups, each a list of pages.
 * Search, the sidebar, the breadcrumb and previous/next all read from here.
 */
export type Tab = 'guides' | 'api' | 'webhooks' | 'changelog'

export interface PageMeta {
  slug: string
  title: string
  summary: string
  /** For API pages: the main method, shown as a small mark. */
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** For API pages: the object and each endpoint, listed under the page in the sidebar and linked by anchor. */
  items?: { id: string; title: string; method?: 'GET' | 'POST' }[]
}

export interface Group {
  tab: Tab
  title: string
  pages: PageMeta[]
}

export const TABS: { id: Tab; label: string; home: string }[] = [
  { id: 'guides', label: 'Guides', home: '/introduction' },
  { id: 'api', label: 'API reference', home: '/api' },
  { id: 'webhooks', label: 'Webhooks', home: '/webhooks' },
  { id: 'changelog', label: 'Changelog', home: '/changelog' },
]

export const NAV: Group[] = [
  {
    tab: 'guides',
    title: 'Get started',
    pages: [
      { slug: '/introduction', title: 'Introduction', summary: 'What Money Moves Business does and how payments move through it.' },
      { slug: '/quickstart', title: 'Quickstart', summary: 'Create and test your first checkout.' },
      { slug: '/authentication', title: 'Authentication', summary: 'Create test and live keys, and keep them secure.' },
      { slug: '/test-mode', title: 'Test mode', summary: 'Test payments and the full checkout flow before verification.' },
      { slug: '/go-live', title: 'Go live', summary: 'Complete verification and prepare to accept live payments.' },
    ],
  },
  {
    tab: 'guides',
    title: 'SDKs',
    pages: [
      { slug: '/sdk', title: 'Node.js SDK', summary: 'The official SDK: typed objects, pages you can loop over, safe retries and webhook signatures.' },
      { slug: '/php', title: 'PHP SDK', summary: 'The official PHP library: every endpoint, lists you can loop over, safe retries and webhook signatures.' },
    ],
  },
  {
    tab: 'guides',
    title: 'Plugins',
    pages: [{ slug: '/woocommerce', title: 'WooCommerce', summary: 'Take bank transfer, Money Moves app and stablecoin payments in your WooCommerce store, without code.' }],
  },
  {
    tab: 'guides',
    title: 'Take payments',
    pages: [
      { slug: '/how-payments-work', title: 'How payments work', summary: 'Follow a payment from checkout through settlement.' },
      { slug: '/checkout', title: 'Checkout', summary: 'Create a checkout on your server and send customers to pay.' },
      { slug: '/payment-links', title: 'Payment links', summary: 'Create and share a reusable payment link from the dashboard.' },
      { slug: '/invoices', title: 'Invoices', summary: 'Email a customer an itemised invoice with a due date.' },
      { slug: '/store-qr', title: 'Store QR', summary: 'Accept payments in person with an outlet-specific QR code.' },
      { slug: '/payment-methods', title: 'Methods, coins and networks', summary: 'See how customers pay and which coins are supported on each network.' },
      { slug: '/currencies', title: 'Local fiat and dollars', summary: 'Set prices in NGN or USD and learn how amounts are converted.' },
    ],
  },
  {
    tab: 'guides',
    title: 'Money out',
    pages: [
      { slug: '/settlement', title: 'Settlement', summary: 'Choose where each payment is sent: your bank, Money Moves account or business wallet.' },
      { slug: '/business-wallet', title: 'Business wallet', summary: 'Learn how your self-custody wallet works and how to send funds from it.' },
      { slug: '/refunds', title: 'Refunds', summary: 'Refund a customer through their original payment method.' },
    ],
  },
  {
    tab: 'guides',
    title: 'AI agents',
    pages: [{ slug: '/agents', title: 'PayBox', summary: 'Use the Money Moves plugin for PayBox inside ChatGPT and Claude to pay a business or run your checkout.' }],
  },
  {
    tab: 'guides',
    title: 'Good to know',
    pages: [
      { slug: '/fees', title: 'Fees', summary: 'Review payment, payout and refund fees, and see who pays them.' },
      { slug: '/statuses', title: 'Statuses', summary: 'Understand checkout, payment, settlement and refund statuses.' },
      { slug: '/errors', title: 'Errors', summary: 'Look up error codes and learn how to resolve them.' },
      { slug: '/idempotency', title: 'Idempotency and limits', summary: 'Retry requests safely, paginate results and manage rate limits.' },
    ],
  },
  {
    tab: 'api',
    title: 'General',
    pages: [
      { slug: '/api', title: 'Introduction', summary: 'Base URL, authentication, request formats, errors and shared API conventions.' },
      { slug: '/api/account', title: 'Account', summary: 'Check which business and mode an API key belongs to.', method: 'GET' },
    ],
  },
  {
    tab: 'api',
    title: 'Checkouts',
    pages: [
      {
        slug: '/api/checkouts',
        title: 'Checkouts',
        summary: 'Create, retrieve, list and cancel checkouts.',
        method: 'POST',
        items: [
          { id: 'object', title: 'The checkout object' },
          { id: 'create', title: 'Create a checkout', method: 'POST' },
          { id: 'retrieve', title: 'Retrieve a checkout', method: 'GET' },
          { id: 'list', title: 'List checkouts', method: 'GET' },
          { id: 'cancel', title: 'Cancel a checkout', method: 'POST' },
        ],
      },
    ],
  },
  {
    tab: 'api',
    title: 'Payments',
    pages: [
      {
        slug: '/api/payments',
        title: 'Payments',
        summary: 'Retrieve and list payments.',
        method: 'GET',
        items: [
          { id: 'object', title: 'The payment object' },
          { id: 'retrieve', title: 'Retrieve a payment', method: 'GET' },
          { id: 'list', title: 'List payments', method: 'GET' },
        ],
      },
    ],
  },
  {
    tab: 'api',
    title: 'Settlements',
    pages: [
      {
        slug: '/api/settlements',
        title: 'Settlements',
        summary: 'See where payments were settled and when they arrived.',
        method: 'GET',
        items: [
          { id: 'object', title: 'The settlement object' },
          { id: 'list', title: 'List settlements', method: 'GET' },
          { id: 'retrieve', title: 'Retrieve a settlement', method: 'GET' },
        ],
      },
    ],
  },
  {
    tab: 'api',
    title: 'Refunds',
    pages: [
      {
        slug: '/api/refunds',
        title: 'Refunds',
        summary: 'Start a refund and follow it to the customer.',
        method: 'POST',
        items: [
          { id: 'object', title: 'The refund object' },
          { id: 'create', title: 'Create a refund', method: 'POST' },
          { id: 'retrieve', title: 'Retrieve a refund', method: 'GET' },
          { id: 'list', title: 'List refunds', method: 'GET' },
          { id: 'cancel', title: 'Cancel a refund', method: 'POST' },
          { id: 'simulate', title: 'Simulate funding (test)', method: 'POST' },
        ],
      },
    ],
  },
  {
    tab: 'api',
    title: 'Disputes',
    pages: [
      {
        slug: '/api/disputes',
        title: 'Disputes',
        summary: 'Read and answer disputes on your payments.',
        method: 'GET',
        items: [
          { id: 'object', title: 'The dispute object' },
          { id: 'list', title: 'List disputes', method: 'GET' },
          { id: 'retrieve', title: 'Retrieve a dispute', method: 'GET' },
          { id: 'reply', title: 'Reply to a dispute', method: 'POST' },
          { id: 'create', title: 'Open a test dispute (test)', method: 'POST' },
          { id: 'accept', title: 'Accept your reply (test)', method: 'POST' },
        ],
      },
    ],
  },
  {
    tab: 'api',
    title: 'Balance and rates',
    pages: [
      { slug: '/api/balance', title: 'Balance', summary: 'View pending settlements and your business wallet holdings.', method: 'GET', items: [{ id: 'retrieve', title: 'Get your balance', method: 'GET' }] },
      { slug: '/api/rates', title: 'Rates', summary: 'Get the current NGN-to-USD exchange rate.', method: 'GET', items: [{ id: 'retrieve', title: "Get today's rate", method: 'GET' }] },
    ],
  },
  {
    tab: 'api',
    title: 'Events',
    pages: [
      {
        slug: '/api/events',
        title: 'Events',
        summary: 'Retrieve the events sent to your webhook endpoints.',
        method: 'GET',
        items: [
          { id: 'object', title: 'The event object' },
          { id: 'list', title: 'List events', method: 'GET' },
          { id: 'retrieve', title: 'Retrieve an event', method: 'GET' },
        ],
      },
    ],
  },
  {
    tab: 'webhooks',
    title: 'Webhooks',
    pages: [
      { slug: '/webhooks', title: 'Overview', summary: 'Receive payment and settlement updates on your server.' },
      { slug: '/webhooks/events', title: 'Event types', summary: 'Review each event type and its payload.' },
      { slug: '/webhooks/signatures', title: 'Verifying signatures', summary: 'Verify each event came from Money Moves before processing it.' },
      { slug: '/webhooks/retries', title: 'Retries and delivery', summary: 'Understand delivery retries and handle duplicate or out-of-order events.' },
    ],
  },
  {
    tab: 'changelog',
    title: 'Changelog',
    pages: [{ slug: '/changelog', title: 'Changelog', summary: 'Product updates, newest first.' }],
  },
]

export const ALL_PAGES = NAV.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.title, tab: g.tab })))

export const findPage = (slug: string) => ALL_PAGES.find((p) => p.slug === slug)

export const DASHBOARD_URL: string = import.meta.env.VITE_DASHBOARD_URL ?? (import.meta.env.DEV ? 'http://localhost:5175' : 'https://business.usemoneymoves.xyz')
/** Where the API answers: the dashboard's own host. */
export const API_BASE = 'https://business.usemoneymoves.xyz/api/v1'
