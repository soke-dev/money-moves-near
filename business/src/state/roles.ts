/**
 * The roles on a team, and what each can do, as the API holds them. The
 * screens read this to show or hide what a role can't use; the API refuses it
 * either way.
 *
 * Only the owner sends from the business wallet, adds bank accounts or links
 * Money Moves. Admins can see the wallet, its balance and history.
 */
import { LIVE } from '@/lib/api'
import { useSession } from './session'

export type RoleId = 'OWNER' | 'ADMIN' | 'FINANCE' | 'DEVELOPER' | 'SUPPORT' | 'VIEWER'

export const ROLE_INFO: Record<RoleId, { name: string; about: string }> = {
  OWNER: { name: 'Owner', about: 'The person who opened the business. The only one who can send from the business wallet, add bank accounts or link Money Moves.' },
  ADMIN: { name: 'Admin', about: 'Runs the business day to day: payments, refunds, the team and settings. Sees the business wallet but can’t send from it, add bank accounts or link Money Moves.' },
  FINANCE: { name: 'Finance', about: 'Payments, refunds, payment links and invoices, and replies to disputes.' },
  DEVELOPER: { name: 'Developer', about: 'API keys, webhooks and logs, plus payment links and invoices.' },
  SUPPORT: { name: 'Support', about: 'Sees payments and customers, and replies to disputes.' },
  VIEWER: { name: 'Viewer', about: 'Sees everything the team sees, and changes nothing.' },
}

/** The roles someone can be invited as: every one but owner. */
export const INVITABLE: RoleId[] = ['ADMIN', 'FINANCE', 'DEVELOPER', 'SUPPORT', 'VIEWER']

export type Permission =
  | 'view'
  | 'refund'
  | 'disputes'
  | 'collect'
  | 'wallet'
  | 'wallet_send'
  | 'payout_places'
  | 'settlement'
  | 'verify'
  | 'branding'
  | 'team'
  | 'developers'
  | 'details'
  | 'referrals'

/** Each permission, who has it, and how the Roles page says it. */
export const PERMISSIONS: { id: Permission; label: string; roles: RoleId[] }[] = [
  { id: 'view', label: 'See payments, customers, refunds and disputes', roles: ['OWNER', 'ADMIN', 'FINANCE', 'DEVELOPER', 'SUPPORT', 'VIEWER'] },
  { id: 'refund', label: 'Refund payments', roles: ['OWNER', 'ADMIN', 'FINANCE'] },
  { id: 'disputes', label: 'Reply to disputes', roles: ['OWNER', 'ADMIN', 'FINANCE', 'SUPPORT'] },
  { id: 'collect', label: 'Make payment links, invoices and outlets', roles: ['OWNER', 'ADMIN', 'FINANCE', 'DEVELOPER'] },
  { id: 'settlement', label: 'Choose the settlement network and who pays the fee', roles: ['OWNER', 'ADMIN', 'FINANCE'] },
  { id: 'wallet', label: 'See the business wallet’s balance and history', roles: ['OWNER', 'ADMIN'] },
  { id: 'wallet_send', label: 'Send from the business wallet', roles: ['OWNER'] },
  { id: 'payout_places', label: 'Add bank accounts and link Money Moves', roles: ['OWNER'] },
  { id: 'verify', label: 'Verification and compliance requests', roles: ['OWNER', 'ADMIN'] },
  { id: 'branding', label: 'Logo and checkout look', roles: ['OWNER', 'ADMIN'] },
  { id: 'team', label: 'Invite and manage the team', roles: ['OWNER', 'ADMIN'] },
  { id: 'developers', label: 'API keys, webhooks and logs', roles: ['OWNER', 'ADMIN', 'DEVELOPER'] },
  { id: 'details', label: 'Change the business details', roles: ['OWNER'] },
  { id: 'referrals', label: 'Invite other businesses', roles: ['OWNER', 'ADMIN'] },
]

/** Your role on this business. The preview is always the owner. */
export function useRole(): RoleId {
  const { business } = useSession()
  return LIVE ? ((business?.role as RoleId | undefined) ?? 'VIEWER') : 'OWNER'
}

/** Whether your role can do this. */
export function useCan() {
  const role = useRole()
  return (p: Permission) => PERMISSIONS.find((x) => x.id === p)?.roles.includes(role) ?? false
}
