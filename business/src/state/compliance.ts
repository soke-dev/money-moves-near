/**
 * Compliance tasks: what we still need from a business, one item at a time.
 *
 * Activation only checks the person opening the account (NIN and a selfie,
 * by Didit). Everything else - a BVN, a director's ID, a fresh proof of
 * address - arrives here later as a task, so asking for it never holds an
 * account up. A task we will want eventually but not yet sits under "Not
 * needed yet".
 */
import { BUSINESSES } from '@/data/mock'
import { createStore } from './store'

export type TaskState = 'action' | 'later' | 'review' | 'done'
export type TaskKind = 'activate' | 'bvn' | 'document' | 'detail' | 'text'

export interface Task {
  id: string
  kind: TaskKind
  title: string
  /** Who it is about, for a task about a person. */
  who?: { name: string; roles: string; email?: string }
  /** What to do, in a sentence. */
  ask: string
  state: TaskState
  updatedAt: string
  /** Live: the request it answers - sent to the API rather than kept here. */
  requestId?: string
  /** Why our team turned the last answer down. */
  note?: string
  /** What was sent, as it can be shown back. */
  sent?: string
}

const H = 3_600_000
const ago = (h: number) => new Date(Date.now() - h * H).toISOString()

export const BVN_ASK = 'Add the Bank Verification Number. Dial *565*0# on the phone number linked to the bank account to see it.'

const bvn = (name: string, roles: string, state: TaskState, email?: string): Task => ({
  id: `bvn_${name.toLowerCase().replace(/\W+/g, '_')}`,
  kind: 'bvn',
  title: `BVN for ${name}`,
  who: { name, roles, email },
  ask: BVN_ASK,
  state,
  updatedAt: ago(state === 'action' ? 20 : 30),
})

const detail = (id: string, title: string, ask: string, state: TaskState, h: number, kind: TaskKind = 'detail'): Task => ({
  id,
  kind,
  title,
  ask,
  state,
  updatedAt: ago(h),
})

function seed(businessId: string): Task[] {
  const b = BUSINESSES.find((x) => x.id === businessId)
  if (b?.verify === 'verified') {
    return [
      bvn('Okotete Chris', 'representative, director', 'action', 'owner@example.com'),
      bvn('Ada Nwosu', 'director', 'later'),
      detail('poa_ada', 'Proof of address for Ada Nwosu', 'A utility bill, bank statement or tenancy agreement from the last three months showing their home address.', 'later', 30, 'document'),
      detail('biz_address', 'Proof of business address', 'A recent document showing the registered business address.', 'review', 6, 'document'),
      detail('didit', 'Identity check for Okotete Chris', 'Your ID and a selfie.', 'done', 400),
      detail('reg_name', 'Registered business name', 'The name exactly as it is registered with CAC.', 'done', 380),
      detail('reg_number', 'Registration number', 'The RC, BN or IT number on the certificate.', 'done', 380),
      detail('structure', 'Business structure', 'How the business is registered.', 'done', 380),
      detail('reg_date', 'Date of registration', 'When the business was registered.', 'done', 380),
      detail('industry', 'Industry', 'What the business sells.', 'done', 380),
      detail('bank', 'Settlement bank account', 'An account in the business name, matched to CAC.', 'done', 370),
    ]
  }
  if (b?.verify === 'review') {
    return [
      detail('details', 'Business details', 'Registered name, number, address and what you sell.', 'review', 26),
      detail('docs', 'Registration documents', 'Certificate, MEMART and status report.', 'review', 26, 'document'),
      detail('bank', 'Settlement bank account', 'An account in the business name, matched to CAC.', 'review', 26),
      detail('didit', 'Identity check for Okotete Chris', 'Your ID and a selfie.', 'done', 27),
      bvn('Okotete Chris', 'representative, director', 'later', 'owner@example.com'),
    ]
  }
  return [detail('activate', 'Verify your business', 'Tell us who you are and what your business does. Takes a few minutes.', 'action', 0, 'activate')]
}

export const tasksStore = createStore<Task[]>('mmb_tasks_v1', seed)

export const useTasks = (businessId: string | undefined) => tasksStore.use(businessId)

/** What a freshly submitted activation looks like from the business's side. */
export function tasksAfterSubmit(p: {
  rep: { name: string; email: string; roles: string }
  registered: boolean
  others: { name: string; roles: string; email: string }[]
  bank: boolean
}): Task[] {
  return [
    detail('didit', `Identity check for ${p.rep.name}`, 'Your ID and a selfie.', 'done', 0),
    detail('details', p.registered ? 'Business details' : 'About you and what you sell', 'Everything you told us when you activated.', 'review', 0),
    ...(p.registered ? [detail('docs', 'Registration documents', 'Your CAC filings and proof of business address.', 'review', 0, 'document')] : []),
    ...(p.bank ? [detail('bank', 'Settlement bank account', 'Matched to the name on your NIN or CAC record.', 'review', 0)] : []),
    bvn(p.rep.name, p.rep.roles, 'later', p.rep.email),
    ...p.others.map((o) => bvn(o.name, o.roles, 'later', o.email)),
  ]
}
