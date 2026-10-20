import { useEffect } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from '@/layouts/AppShell'
import { useSession } from '@/state/session'
import { ForgotPassword, Login, Otp, SelectBusiness, SignUp } from '@/pages/auth'
import { CreateBusiness } from '@/pages/onboarding'
import { Activate } from '@/pages/activate'
import { Compliance } from '@/pages/compliance'
import { Branding } from '@/pages/branding'
import { GettingStarted, Home } from '@/pages/home'
import { Customers, Payments, Refunds } from '@/pages/transactions'
import { Disputes } from '@/pages/disputes'
import { BusinessWallet, Settlements } from '@/pages/balances'
import { Invoices, Outlets, PaymentLinks } from '@/pages/collect'
import { DepositAddresses } from '@/pages/deposits'
import { BusinessPreferences, SettlementSettings } from '@/pages/settings'
import { Roles, Team } from '@/pages/team'
import { Activity } from '@/pages/activity'
import { Reports } from '@/pages/reports'
import { InvitePage } from '@/pages/invite'
import { ApiKeys, DocsRedirect, Events, Logs, Webhooks } from '@/pages/developers'
import { Checkout, CheckoutPreviewFrame } from '@/pages/checkout'
import { ReceiptPage } from '@/pages/receipt'
import { GiveBackPage } from '@/pages/give-back'
import { Profile, Referrals } from '@/pages/account'
import { Privacy, Prohibited, Terms } from '@/pages/legal'
import { Button } from '@/components/ui'
import ChatBubble from '@/components/ChatBubble'

function Root() {
  const { user, business } = useSession()
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={business ? '/dashboard' : '/select-business'} replace />
}

function NotFound() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 text-center">
      <div className="font-mono text-[12px] uppercase tracking-[0.16em] text-dim">404</div>
      <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.03em]">Nothing here.</h1>
      <Link to="/" className="mt-6">
        <Button>Back to the dashboard</Button>
      </Link>
    </div>
  )
}

/**
 * The checkout's own host (pay.usemoneymoves.xyz): checkouts only, at short
 * addresses - /test-money-moves, /o/:slug, /i/:token - and the legal pages
 * they link to. Anything else belongs to the dashboard, on its own host.
 */
const ON_PAY_HOST = typeof window !== "undefined" && window.location.hostname.startsWith("pay.")

function ToDashboard() {
  useEffect(() => {
    window.location.replace(`${window.location.protocol}//${window.location.hostname.replace(/^pay./, "business.")}`)
  }, [])
  return null
}

function PayHost() {
  return (
    <Routes>
      <Route path="/r/:token" element={<ReceiptPage />} />
      <Route path="/pay/r/:token" element={<ReceiptPage />} />
      <Route path="/x/:token" element={<GiveBackPage />} />
      <Route path="/pay/x/:token" element={<GiveBackPage />} />
      <Route path="/o/:slug" element={<Checkout outlet />} />
      <Route path="/i/:slug" element={<Checkout invoice />} />
      <Route path="/pay/:slug" element={<Checkout />} />
      <Route path="/pay/o/:slug" element={<Checkout outlet />} />
      <Route path="/pay/i/:slug" element={<Checkout invoice />} />
      <Route path="/legal/terms" element={<Terms />} />
      <Route path="/legal/privacy" element={<Privacy />} />
      <Route path="/legal/prohibited" element={<Prohibited />} />
      <Route path="/terms" element={<Navigate to="/legal/terms" replace />} />
      <Route path="/privacy" element={<Navigate to="/legal/privacy" replace />} />
      <Route path="/:slug" element={<Checkout />} />
      <Route path="*" element={<ToDashboard />} />
    </Routes>
  )
}

export default function App() {
  if (ON_PAY_HOST) return <PayHost />
  return (
    <>
    <Routes>
      <Route path="/" element={<Root />} />

      <Route path="/signup" element={<SignUp />} />
      <Route path="/login" element={<Login />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/select-business" element={<SelectBusiness />} />
      <Route path="/otp" element={<Otp />} />
      <Route path="/onboarding" element={<Activate />} />
      <Route path="/verify" element={<Activate />} />
      <Route path="/business/new" element={<CreateBusiness />} />
      <Route path="/pay/:slug" element={<Checkout />} />
      <Route path="/pay/o/:slug" element={<Checkout outlet />} />
      <Route path="/pay/i/:slug" element={<Checkout invoice />} />
      <Route path="/pay/r/:token" element={<ReceiptPage />} />
      <Route path="/pay/x/:token" element={<GiveBackPage />} />
      <Route path="/checkout-preview" element={<CheckoutPreviewFrame />} />
      <Route path="/legal/terms" element={<Terms />} />
      <Route path="/legal/privacy" element={<Privacy />} />
      <Route path="/legal/prohibited" element={<Prohibited />} />
      <Route path="/terms" element={<Navigate to="/legal/terms" replace />} />
      <Route path="/privacy" element={<Navigate to="/legal/privacy" replace />} />

      <Route element={<AppShell />}>
        <Route path="/getting-started" element={<GettingStarted />} />
        <Route path="/dashboard" element={<Home />} />
        <Route path="/transactions" element={<Payments />} />
        <Route path="/transactions/refunds" element={<Refunds />} />
        <Route path="/transactions/disputes" element={<Disputes />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/balances" element={<BusinessWallet />} />
        <Route path="/balances/history" element={<Navigate to="/balances" replace />} />
        <Route path="/balances/settlements" element={<Settlements />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/balances/conversions" element={<Navigate to="/balances" replace />} />
        <Route path="/collect/links" element={<PaymentLinks />} />
        <Route path="/collect/invoices" element={<Invoices />} />
        <Route path="/collect/outlets" element={<Outlets />} />
        <Route path="/collect/addresses" element={<DepositAddresses />} />
        <Route path="/payouts" element={<Navigate to="/balances" replace />} />
        <Route path="/payouts/beneficiaries" element={<Navigate to="/balances" replace />} />
        <Route path="/settings/business" element={<BusinessPreferences />} />
        <Route path="/settings/settlement" element={<SettlementSettings />} />
        <Route path="/settings/compliance" element={<Compliance />} />
        <Route path="/settings/branding" element={<Branding />} />
        <Route path="/settings/team" element={<Team />} />
        <Route path="/settings/profile" element={<Profile />} />
        <Route path="/settings/referrals" element={<Referrals />} />
        <Route path="/settings/roles" element={<Roles />} />
        <Route path="/settings/activity" element={<Activity />} />
        <Route path="/settings/api-keys" element={<ApiKeys />} />
        <Route path="/settings/webhooks" element={<Webhooks />} />
        <Route path="/settings/events" element={<Events />} />
        <Route path="/settings/logs" element={<Logs />} />
        <Route path="/developers/docs" element={<DocsRedirect />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
    <ChatBubble />
    </>
  )
}
