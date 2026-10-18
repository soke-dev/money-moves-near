/**
 * A business's invoices: the sample ones to start, then whatever it sends,
 * reminds, or deletes - shared by the Invoices page and the invoice checkout.
 */
import { INVOICES, type Invoice } from '@/data/mock'
import { createStore } from './store'
import { LIVE } from '@/lib/api'

// Preview only: live invoices come from the API.
export const invoicesStore = LIVE ? createStore<Invoice[]>('mmb_invoices_live_v1', () => []) : createStore<Invoice[]>('mmb_invoices_v1', () => INVOICES)

export const useInvoices = (businessId: string | undefined) => invoicesStore.use(businessId)
