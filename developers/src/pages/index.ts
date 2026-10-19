import type { ComponentType } from 'react'
import { Authentication, GoLive, Introduction, Quickstart, TestMode } from './start'
import { Checkout, Currencies, HowPaymentsWork, Invoices, PaymentLinks, PaymentMethods, StoreQr } from './payments'
import { BusinessWallet, Refunds, Settlement } from './money-out'
import { Errors, Fees, Idempotency, Statuses } from './reference'
import { Agents } from './agents'
import { ApiAccount, ApiBalance, ApiCheckouts, ApiEvents, ApiOverview, ApiPayments, ApiRates, ApiRefunds, ApiDisputes, ApiSettlements } from './api'
import { Changelog } from './changelog'
import { Sdk } from './sdk'
import { WebhookEvents, WebhookRetries, WebhookSignatures, WebhooksOverview } from './webhooks'

/** Every page, by its address. The map in nav.ts says where each sits. */
export const PAGES: Record<string, ComponentType> = {
  '/introduction': Introduction,
  '/quickstart': Quickstart,
  '/authentication': Authentication,
  '/test-mode': TestMode,
  '/go-live': GoLive,
  '/how-payments-work': HowPaymentsWork,
  '/checkout': Checkout,
  '/payment-links': PaymentLinks,
  '/invoices': Invoices,
  '/store-qr': StoreQr,
  '/payment-methods': PaymentMethods,
  '/currencies': Currencies,
  '/settlement': Settlement,
  '/business-wallet': BusinessWallet,
  '/refunds': Refunds,
  '/fees': Fees,
  '/statuses': Statuses,
  '/errors': Errors,
  '/idempotency': Idempotency,
  '/agents': Agents,
  '/api': ApiOverview,
  '/api/account': ApiAccount,
  '/api/checkouts': ApiCheckouts,
  '/api/payments': ApiPayments,
  '/api/settlements': ApiSettlements,
  '/api/refunds': ApiRefunds,
  '/api/disputes': ApiDisputes,
  '/api/balance': ApiBalance,
  '/api/rates': ApiRates,
  '/api/events': ApiEvents,
  '/sdk': Sdk,
  '/webhooks': WebhooksOverview,
  '/webhooks/events': WebhookEvents,
  '/webhooks/signatures': WebhookSignatures,
  '/webhooks/retries': WebhookRetries,
  '/changelog': Changelog,
}
