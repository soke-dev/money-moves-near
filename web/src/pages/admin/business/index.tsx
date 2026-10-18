/**
 * The admin console's Business side: Money Moves Business, from the same
 * console and the same sign-in.
 *
 * It answers the same first question as the personal side - is anything
 * stuck - and then gives the levers: verify, deactivate or reactivate a business, put
 * its details right, set its fee, review its application, approve a bank
 * account the automatic check couldn't match, and sort out a settlement that
 * didn't land.
 *
 * Lists are sections; a business, a settlement, a payment or an application
 * is a page of its own (see nav.ts). The section's list stays mounted under
 * an open record, so going back finds it exactly as it was.
 */
import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { ArrowLeftRight, BadgeCheck, Building2, Coins, Landmark, LayoutDashboard, MessagesSquare, RotateCcw, ShieldAlert, ToggleLeft } from 'lucide-react'
import { scrollFor, type OpenRecord, type RecordKind } from './nav'
import { Businesses, Overview, Payments, Settlements } from './sections'
import { Applications, ApplicationPage } from './Application'
import { Services } from './Services'
import { BusinessPage } from './BusinessPage'
import { SettlementPage } from './SettlementPage'
import { PaymentPage } from './PaymentPage'
import { RefundPage, Refunds } from './Refunds'
import { DisputePage, Disputes } from './Disputes'
import { Support } from './Support'
import { Crypto } from './Crypto'

export { bizChanged } from './client'
export { readRecord, useRecord } from './nav'
export { SANS } from './kit'

export const BUSINESS_SECTIONS = [
  { id: 'b_overview', label: 'Overview', Icon: LayoutDashboard },
  { id: 'b_businesses', label: 'Businesses', Icon: Building2 },
  { id: 'b_kyc', label: 'KYC', Icon: BadgeCheck },
  { id: 'b_settlements', label: 'Settlements', Icon: Landmark },
  { id: 'b_payments', label: 'Payments', Icon: ArrowLeftRight },
  { id: 'b_refunds', label: 'Refunds', Icon: RotateCcw },
  { id: 'b_disputes', label: 'Disputes', Icon: ShieldAlert },
  { id: 'b_crypto', label: 'Crypto', Icon: Coins },
  { id: 'b_support', label: 'Support', Icon: MessagesSquare },
  { id: 'b_services', label: 'Services', Icon: ToggleLeft },
] as const

export type BusinessSectionId = (typeof BUSINESS_SECTIONS)[number]['id']
export type BizJump = { section: BusinessSectionId; filter?: string }

/** The section a record belongs to - what the rail shows as current when one is opened from a link. */
export const RECORD_SECTION: Record<RecordKind, BusinessSectionId> = {
  business: 'b_businesses',
  settlement: 'b_settlements',
  payment: 'b_payments',
  application: 'b_kyc',
  refund: 'b_refunds',
  dispute: 'b_disputes',
}

export function BusinessConsole({ section, filter, onJump, record }: { section: BusinessSectionId; filter?: string; onJump: (j: BizJump) => void; record: OpenRecord | null }) {
  const location = useLocation()
  // Back to a list: back to where on it you were.
  useLayoutEffect(() => {
    const y = scrollFor(location.key)
    if (y != null) window.scrollTo(0, y)
  }, [location.key])
  return (
    <>
      <div hidden={!!record}>
        {section === 'b_overview' && <Overview onJump={onJump} />}
        {section === 'b_businesses' && <Businesses initial={filter} />}
        {section === 'b_kyc' && <Applications initial={filter} />}
        {section === 'b_settlements' && <Settlements initial={filter} />}
        {section === 'b_payments' && <Payments />}
        {section === 'b_refunds' && <Refunds initial={filter} />}
        {section === 'b_disputes' && <Disputes initial={filter} />}
        {section === 'b_crypto' && <Crypto />}
        {section === 'b_support' && <Support />}
        {section === 'b_services' && <Services />}
      </div>
      {record?.kind === 'business' && <BusinessPage key={record.id} id={record.id} />}
      {record?.kind === 'settlement' && <SettlementPage key={record.id} id={record.id} />}
      {record?.kind === 'payment' && <PaymentPage key={record.id} id={record.id} />}
      {record?.kind === 'application' && <ApplicationPage key={record.id} businessId={record.id} />}
      {record?.kind === 'refund' && <RefundPage key={record.id} id={record.id} />}
      {record?.kind === 'dispute' && <DisputePage key={record.id} id={record.id} />}
    </>
  )
}
