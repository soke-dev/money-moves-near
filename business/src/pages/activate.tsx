/**
 * Activating a business: the questions that take it from test mode to live.
 *
 * Two shapes. "Just me" - a freelancer, a creator, a business not registered
 * yet - is the person, what they sell and where the money goes. A registered
 * business adds its CAC details, its filings and the people on them.
 *
 * Either way, only the person opening the account is checked up front: their
 * ID document and a liveness check, by Didit. Everything else goes to our team to review, and
 * anything more we need later (a BVN, a director's ID) arrives as a task in
 * Compliance instead of holding the account up now.
 *
 * The draft saves as you type, so "Save and finish later" means it.
 *
 * Live, all of it is real: answers are saved to the API, documents are
 * uploaded (and encrypted there), the identity check is Didit's own page and
 * Didit's own decision, and submitting puts the business in our team's queue.
 * Nothing about it is ever simulated. The preview (?demo=) walks the same
 * screens with sample data and does no identity check at all.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  FileText,
  Fingerprint,
  Info,
  Loader2,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  X,
} from '@/components/icons'
import { Logo } from '@/components/brand'
import { Badge, Button, Checkbox, Field, Input, Modal, OptionCard, Select, Textarea, cx } from '@/components/ui'
import { BLANK_WALLET, ChannelSettlement, WalletTargetForm, type WalletTarget } from '@/components/Settlement'
import { COUNTRIES, idTypesFor } from '@/lib/countries'
import { MoneyMovesLinker } from '@/components/MoneyMovesLinker'
import { ManualIdentity } from '@/components/ManualIdentity'
import { bankAccountsPath, bankLabel, banksOf, mmsOf, targetsStore, useTargets, type BankAccount } from '@/state/targets'
import { ApiError, LIVE, api, applicationPath, uploadFile, type ApiApplication, type Me } from '@/lib/api'
import { reload, useApi } from '@/lib/useApi'
import { AddBankModal } from '@/pages/settings'

import { useSession } from '@/state/session'
import { createStore } from '@/state/store'
import { tasksAfterSubmit, tasksStore } from '@/state/compliance'
import { INDUSTRIES, NG_STATES, type Destination } from '@/data/mock'

/* ─── What we ask, by business shape ───────────────────────────────── */

type Kind = 'individual' | 'registered'
type Structure = 'BN' | 'LTD' | 'PLC' | 'IT'
type StepId = 'setup' | 'business' | 'documents' | 'you' | 'people' | 'product' | 'payout' | 'review'

const STRUCTURES: Record<Structure, { label: string; sub: string; prefix: string; type: string }> = {
  BN: { label: 'Business name', sub: 'A sole trader or partnership registered with CAC. No shareholders.', prefix: 'BN', type: 'Business name' },
  LTD: { label: 'Private company (Ltd)', sub: 'Limited by shares, with directors and shareholders.', prefix: 'RC', type: 'Limited liability company' },
  PLC: { label: 'Public company (PLC)', sub: 'A company whose shares can be offered to the public.', prefix: 'RC', type: 'Public limited company' },
  IT: { label: 'Incorporated trustees', sub: 'An NGO, church, association or foundation run by trustees.', prefix: 'IT', type: 'Incorporated trustees' },
}

const ADDRESS_DOC = {
  id: 'address',
  label: 'Proof of business address',
  hint: 'A utility bill, bank statement or tenancy agreement from the last three months.',
}

const DOCS: Record<Structure, { id: string; label: string; hint: string }[]> = {
  BN: [{ id: 'cert', label: 'Certificate of registration', hint: 'The certificate CAC issued for the business name.' }, ADDRESS_DOC],
  LTD: [
    { id: 'cert', label: 'Certificate of incorporation', hint: 'The certificate CAC issued when the company was formed.' },
    { id: 'memart', label: 'Memorandum and articles of association', hint: 'The MEMART, what the company does and who owns it.' },
    { id: 'status', label: 'Status report', hint: 'A recent CAC status report listing your current directors and shareholders.' },
    ADDRESS_DOC,
  ],
  PLC: [
    { id: 'cert', label: 'Certificate of incorporation', hint: 'The certificate CAC issued when the company was formed.' },
    { id: 'memart', label: 'Memorandum and articles of association', hint: 'The MEMART, what the company does and who owns it.' },
    { id: 'status', label: 'Status report', hint: 'A recent CAC status report listing your current directors.' },
    ADDRESS_DOC,
  ],
  IT: [
    { id: 'cert', label: 'Certificate of registration', hint: 'The certificate issued when the trustees were incorporated.' },
    { id: 'constitution', label: 'Constitution', hint: 'The governing document your trustees registered, in place of a MEMART.' },
    ADDRESS_DOC,
  ],
}

/** Who the "people" step is about, in the words each structure uses. */
const PEOPLE: Record<Structure, { title: string; sub: string; me: string; role: string }> = {
  BN: { title: 'Owners and partners', sub: 'Everyone named on the business name registration.', me: "I'm an owner or partner", role: 'owner' },
  LTD: { title: 'Directors and owners', sub: 'Add every director on your filing, and anyone who owns 25% or more. You can add smaller owners too, but you do not have to.', me: "I'm a director", role: 'director' },
  PLC: { title: 'Directors and owners', sub: 'Add every director on your filing, and anyone who owns 25% or more. You can add smaller owners too, but you do not have to.', me: "I'm a director", role: 'director' },
  IT: { title: 'Trustees', sub: 'Every trustee named on your registration.', me: "I'm a trustee", role: 'trustee' },
}

const BANKS = ['Access Bank', 'First Bank', 'GTBank', 'Kuda', 'Moniepoint', 'Nombank MFB', 'Opay', 'Palmpay', 'Providus', 'UBA', 'Wema Bank', 'Zenith Bank']

interface Person {
  id: string
  first: string
  last: string
  email: string
  phone: string
  dob: string
  /** Where their ID was issued (ISO code), and which ID it is. */
  idCountry: string
  idType: string
  street: string
  city: string
  state: string
  /** ISO code. */
  country: string
  postal: string
  director: boolean
  owner: boolean
  share: string
}

const blankPerson = (): Person => ({
  id: Math.random().toString(36).slice(2, 9),
  first: '',
  last: '',
  email: '',
  phone: '',
  dob: '',
  idCountry: 'NG',
  idType: '',
  street: '',
  city: '',
  state: '',
  country: 'NG',
  postal: '',
  director: true,
  owner: false,
  share: '',
})

/** Older answers lack the newer fields: fill them in, so nothing reads undefined. */
const asPerson = (p: Partial<Person>): Person => ({ ...blankPerson(), ...p })

/** A driver's licence has two sides worth seeing; every other ID, the front. */
const needsBack = (idType: string) => /licen[cs]e/i.test(idType)
/** Their ID photos are stored like any document, named by the person: id-front:<id>, id-back:<id>. */
const idDoc = (p: Pick<Person, 'id'>, side: 'front' | 'back') => `id-${side}:${p.id}`
const idDocsDone = (p: Person, docs: Record<string, string>) => !!docs[idDoc(p, 'front')] && (!needsBack(p.idType) || !!docs[idDoc(p, 'back')])

/** Whether everything we ask about a person is there. A company's person is a director, an owner, or both. */
function personComplete(raw: Partial<Person>, companyish: boolean) {
  const p = asPerson(raw)
  const has = (v: string) => v.trim().length > 0
  const share = Number(p.share)
  return (
    has(p.first) &&
    has(p.last) &&
    has(p.dob) &&
    /\S+@\S+\.\S+/.test(p.email) &&
    p.phone.replace(/\D/g, '').length >= 7 &&
    has(p.idCountry) &&
    has(p.idType) &&
    has(p.street) &&
    has(p.city) &&
    has(p.state) &&
    has(p.country) &&
    has(p.postal) &&
    (!companyish || p.director || p.owner) &&
    (!companyish || !p.owner || (share > 0 && share <= 100))
  )
}

interface Draft {
  kind: Kind | null
  structure: Structure | null
  legalName: string
  regDate: string
  regNumber: string
  tin: string
  bizStreet: string
  bizCity: string
  bizState: string
  category: string
  docs: Record<string, string>
  didit: 'idle' | 'running' | 'done'
  phone: string
  street: string
  city: string
  state: string
  social: string
  proofOfAddress: string
  repDirector: boolean
  repOwner: boolean
  repShare: string
  people: Person[]
  website: string
  /** The business's social pages - each optional, a link or an @handle. */
  socials: { instagram: string; x: string; tiktok: string; facebook: string }
  supportPhone: string
  description: string
  supportEmail: string
  volume: string
  destination: Destination | null
  bank: string
  account: string
  accountName: string
  mmUser: string
  wallet?: WalletTarget
  attest: boolean
  visited: StepId[]
}

const EMPTY: Draft = {
  kind: null,
  structure: null,
  legalName: '',
  regDate: '',
  regNumber: '',
  tin: '',
  bizStreet: '',
  bizCity: '',
  bizState: '',
  category: '',
  docs: {},
  didit: 'idle',
  phone: '',
  street: '',
  city: '',
  state: '',
  social: '',
  proofOfAddress: '',
  repDirector: true,
  repOwner: false,
  repShare: '',
  people: [],
  website: '',
  socials: { instagram: '', x: '', tiktok: '', facebook: '' },
  supportPhone: '',
  description: '',
  supportEmail: '',
  volume: '',
  destination: null,
  bank: '',
  account: '',
  accountName: '',
  mmUser: '',
  attest: false,
  visited: ['setup'],
}

const drafts = createStore<Draft>('mmb_activation_v1', () => EMPTY)

const STEP_META: Record<StepId, { title: string; sub: string }> = {
  setup: { title: "How you're set up", sub: 'Just you, or a registered business' },
  business: { title: 'Business details', sub: 'As registered with CAC' },
  documents: { title: 'Documents', sub: 'Your registration filings' },
  you: { title: 'Your identity', sub: 'Your ID and a selfie' },
  people: { title: 'The people', sub: 'Everyone on your filing' },
  product: { title: 'What you sell', sub: 'And where customers find you' },
  payout: { title: 'Getting paid', sub: 'Where your money lands' },
  review: { title: 'Review and submit', sub: 'One last look' },
}

const stepsFor = (kind: Kind | null): StepId[] =>
  kind === 'registered' ? ['setup', 'business', 'documents', 'you', 'people', 'product', 'payout', 'review'] : ['setup', 'you', 'product', 'payout', 'review']

/** Preview only: sample details for the sample world. Live, they're what Didit read off the person's ID. */
function diditRead(first?: string, last?: string) {
  return { name: first && last ? `${first} ${last}` : 'Ada Okonkwo', dob: '1 April 1998', nin: '•••• ••• 4821' }
}

const fullName = (p: Person) => `${p.first} ${p.last}`.trim()

const wordsIn = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0)
/** The description: long enough to be useful, short enough to read. */
const MIN_CHARS = 100
const MAX_WORDS = 500

/**
 * Everything still missing, step by step, in words a person would use. Live,
 * the server checks it all again on submit - this is only the quick view.
 */
function missing(d: Draft, live?: { banks: number; linked: number; waiting: number; identity: 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'DECLINED' | null; unsent?: boolean }): { step: StepId; label: string }[] {
  const out: { step: StepId; label: string }[] = []
  const need = (step: StepId, ok: unknown, label: string) => !ok && out.push({ step, label })
  need('setup', d.kind, 'Whether you are a registered business')
  if (d.kind === 'registered') {
    need('business', d.structure, 'Business structure')
    need('business', d.legalName, 'Registered business name')
    need('business', d.regDate, 'Date of registration')
    need('business', d.regNumber, 'Registration number')
    need('business', d.bizStreet && d.bizCity && d.bizState, 'Business address')
    need('business', d.category, 'Industry')
    for (const doc of d.structure ? DOCS[d.structure] : []) need('documents', d.docs[doc.id], doc.label)
  }
  // The preview does no identity check, so it can't ask for one.
  // Started is enough to submit - our team sees the result before approving. Declined has to be done again.
  // A manual check counts once it has been sent; one still being taken on a phone doesn't.
  if (live) need('you', !!live.identity && live.identity !== 'DECLINED' && !live.unsent, 'Identity check')
  need('you', d.phone.replace(/\D/g, '').length >= 10, 'Your phone number')
  need('you', d.street && d.city && d.state, 'Your home address')
  if (d.kind === 'registered') {
    const companyish = d.structure === 'LTD' || d.structure === 'PLC'
    need('people', d.people.length > 0, d.structure ? `At least one ${PEOPLE[d.structure].role}` : 'The people on your filing')
    for (const raw of d.people) {
      const p = asPerson(raw)
      const who = fullName(p) || 'A person'
      need('people', personComplete(p, companyish), `${who}'s details`)
      need('people', !!d.docs[idDoc(p, 'front')], `${who}'s ID, a photo of the front`)
      if (needsBack(p.idType)) need('people', !!d.docs[idDoc(p, 'back')], `${who}'s driver's licence, a photo of the back`)
    }
  }
  if (d.kind !== 'registered') need('product', d.category, 'What you sell')
  const described = d.description.trim().length
  need('product', described >= MIN_CHARS, described ? `A description of at least ${MIN_CHARS} characters, ${MIN_CHARS - described} more` : 'A description of what you sell')
  need('product', wordsIn(d.description) <= MAX_WORDS, `A description of ${MAX_WORDS} words or fewer`)
  // Either is enough; one that is filled in has to be right.
  const supportEmailOk = /\S+@\S+\.\S+/.test(d.supportEmail)
  const supportPhoneOk = (d.supportPhone ?? '').replace(/\D/g, '').length >= 10
  need('product', supportEmailOk || supportPhoneOk, 'A support email or phone number')
  if (d.supportEmail.trim()) need('product', supportEmailOk, 'A support email that looks right')
  if ((d.supportPhone ?? '').trim()) need('product', supportPhoneOk, 'A support phone number with all its digits')
  // Every account needs a bank to withdraw naira to; a Money Moves account is an extra.
  // Live, a bank account or a linked Money Moves account - either is enough, as the API decides.
  if (live) need('payout', live.banks > 0 || live.linked > 0, live.waiting ? 'Approve the Money Moves request in the app, or add a bank account' : 'A bank account or a Money Moves account')
  else need('payout', d.account.length === 10 && d.accountName, 'Your bank account')
  return out
}

/* ─── The page ─────────────────────────────────────────────────────── */

/** Live: the application on the server, and what the steps can do with it. */
type LiveApp = {
  application: ApiApplication['application']
  identity: ApiApplication['identity']
  identityReady: boolean
  /** How a new check is done: the partner's page, or photos from a phone. */
  identityMethod: 'auto' | 'manual'
  /** The IDs a new manual check takes. */
  identityIds?: ApiApplication['identityIds']
  /** The application's API path, and a way to read it again - for the manual check's panel. */
  path: string
  reloadApp: () => Promise<unknown>
  /** Owners and admins do the identity check. */
  canManage: boolean
  documents: ApiApplication['documents']
  banks: BankAccount[]
  /** Money Moves accounts asked for: linked, or waiting for the owner's approval. */
  mms: { id: string; username: string; linked: boolean }[]
  owner: { label: string; name: string | null }
  upload: (kind: string, file: File) => Promise<void>
  remove: (kind: string) => Promise<void>
  startIdentity: () => Promise<void>
  refreshIdentity: () => Promise<void>
}

export function Activate() {
  const { business, user, setVerify, updateBusiness, applyMe } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [draft, setDraft] = drafts.use(business?.id)
  const [at, setAt] = useState<StepId>('setup')
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  // Live: the application on the server - its answers, documents and identity check.
  const path = LIVE && business ? applicationPath(business.id) : null
  const app = useApi<ApiApplication>(path)
  const [targets] = useTargets(business?.id)
  const [liveDraft, setLiveDraft] = useState<Draft | null>(null)
  useEffect(() => {
    if (app.data && !liveDraft) setLiveDraft({ ...EMPTY, ...(app.data.application.answers as Partial<Draft>) })
  }, [app.data, liveDraft])

  // Live: answers save a moment after the last change - and at once before leaving for Didit or submitting.
  const unsaved = useRef<Draft | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flush = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const answers = unsaved.current
    unsaved.current = null
    if (answers && path) await api('PUT', `${path}/answers`, { answers })
  }
  useEffect(
    () => () => {
      void flush().catch(() => {})
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Back from Didit: ask Didit what it decided, and open the identity step.
  const returned = params.get('identity') === 'back'
  useEffect(() => {
    if (!returned || !path || !app.data) return
    setParams({}, { replace: true })
    setAt('you')
    void api('POST', `${path}/identity/refresh`)
      .then(() => app.reload())
      .catch(() => {})
  }, [returned, path, app.data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!business) return <Navigate to="/select-business" replace />
  if (LIVE && !liveDraft) {
    return <div className="flex min-h-full items-center justify-center px-6 text-center text-[14px] text-muted">{app.error ? app.error.message : <Loader2 className="size-5 animate-spin" />}</div>
  }
  const stored = LIVE ? liveDraft : draft
  if (!stored) return <Navigate to="/select-business" replace />
  // Open while the application can be changed: never sent, or sent back by our team for a change - which leaves
  // the business "in review" meanwhile. Anything else is with the team (or done), so Compliance shows where it is.
  const appStatus = app.data?.application.status
  const canEdit = business.verify !== 'verified' && (LIVE ? appStatus === 'DRAFT' || appStatus === 'CHANGES_REQUESTED' : business.verify === 'unverified')
  if (!canEdit && !submitted) return <Navigate to="/settings/compliance" replace />

  const documents = app.data?.documents ?? []
  const identity = app.data?.identity ?? null
  const banks = banksOf(targets)
  // Live, the documents and the identity check are the server's; the rest is the draft.
  const d: Draft = LIVE
    ? {
        ...stored,
        docs: Object.fromEntries(documents.filter((x) => x.kind !== 'proofOfAddress').map((x) => [x.kind, x.filename])),
        proofOfAddress: documents.find((x) => x.kind === 'proofOfAddress')?.filename ?? '',
        didit: identity?.status === 'APPROVED' || identity?.status === 'IN_REVIEW' ? 'done' : identity ? 'running' : 'idle',
      }
    : stored
  const set = (patch: Partial<Draft>) => {
    if (!LIVE) return setDraft((p) => ({ ...p, ...patch }))
    setLiveDraft((p) => {
      const next = { ...(p ?? EMPTY), ...patch }
      unsaved.current = next
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void flush().catch(() => {}), 700)
      return next
    })
  }
  const steps = stepsFor(d.kind)
  const i = Math.max(0, steps.indexOf(at))
  const mmList = mmsOf(targets)
  const gaps = missing(d, LIVE ? { banks: banks.length, linked: mmList.filter((m) => m.linked).length, waiting: mmList.filter((m) => !m.linked).length, identity: identity?.status ?? null, unsent: identity?.method === 'manual' && identity.status === 'PENDING' && !identity.submittedAt } : undefined)
  const go = (s: StepId) => {
    set({ visited: d.visited.includes(s) ? d.visited : [...d.visited, s] })
    setAt(s)
    window.scrollTo({ top: 0 })
  }
  const next = () => go(steps[Math.min(i + 1, steps.length - 1)]!)
  const back = () => go(steps[Math.max(i - 1, 0)]!)
  const person = [identity?.firstName, identity?.lastName].filter(Boolean).join(' ') || [user?.firstName, user?.lastName].filter(Boolean).join(' ')
  // Live, who they are is what Didit read off their ID.
  const me = LIVE
    ? { name: person || user?.first || '', dob: identity?.dateOfBirth ?? '—', nin: identity?.documentLast4 ? `•••• ${identity.documentLast4}` : '—' }
    : diditRead(user?.first, user?.last)

  const live: LiveApp | null =
    LIVE && path && app.data
      ? {
          application: app.data.application,
          identity,
          identityReady: app.data.identityReady,
          identityMethod: app.data.identityMethod ?? 'auto',
          identityIds: app.data.identityIds,
          path,
          reloadApp: () => app.reload(),
          canManage: business.role === 'OWNER' || business.role === 'ADMIN',
          documents,
          banks,
          mms: mmList,
          owner:
            d.kind === 'registered'
              ? { label: `the business's registered name: ${business.name.toUpperCase()}`, name: business.name }
              : { label: person ? `your own name: ${person.toUpperCase()}` : 'your own name, as it is on your ID', name: person || null },
          upload: async (kind, file) => {
            await uploadFile(`${path}/documents/${kind}`, file)
            await app.reload()
          },
          remove: async (kind) => {
            const doc = documents.find((x) => x.kind === kind)
            if (!doc) return
            await api('DELETE', `${path}/documents/${doc.id}`)
            await app.reload()
          },
          // Didit's own page, in this tab; it sends them back here when they're done.
          startIdentity: async () => {
            await flush()
            const r = await api<{ url: string }>('POST', `${path}/identity`)
            window.location.assign(r.url)
          },
          refreshIdentity: async () => {
            await api('POST', `${path}/identity/refresh`)
            await app.reload()
          },
        }
      : null

  const submitLive = async () => {
    if (!path) return
    setBusy(true)
    setProblem('')
    try {
      await flush()
      await api('POST', `${path}/submit`, { attest: true })
      setSubmitted(true)
      applyMe(await api<Me>('GET', '/auth/me'))
      window.scrollTo({ top: 0 })
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  const submit = () => {
    if (LIVE) return void submitLive()
    const registered = d.kind === 'registered'
    const label = d.structure ? PEOPLE[d.structure].role : 'director'
    const roles = ['representative', ...(registered && d.repDirector ? [label] : []), ...(registered && d.repOwner ? ['owner'] : [])].join(', ')
    tasksStore.write(
      business.id,
      tasksAfterSubmit({
        rep: { name: me.name, email: user?.email ?? '', roles },
        registered,
        others: registered
          ? d.people.map((p) => ({ name: fullName(p), email: p.email, roles: [p.director && label, p.owner && 'owner'].filter(Boolean).join(', ') || label }))
          : [],
        bank: d.destination === 'bank',
      }),
    )
    updateBusiness(business.id, {
      type: registered && d.structure ? STRUCTURES[d.structure].type : 'Individual',
      onboarded: true,
      // Preselected the first time they make a link or outlet.
      destination: registered ? 'bank' : 'onchain',
    })
    targetsStore.write(business.id, {
      banks: d.accountName ? [{ id: 'bk_1', bank: d.bank, account: d.account, name: d.accountName, verified: false }] : [],
      defaultBank: 'bk_1',
      mms: registered && d.wallet?.username ? [{ id: 'mm_1', username: d.wallet.username.startsWith('@') ? d.wallet.username : `@${d.wallet.username}`, linked: false }] : [],
      defaultMm: 'mm_1',
    })
    setVerify(business.id, 'review')
    drafts.clear(business.id)
    setSubmitted(true)
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="grid grid-cols-1 min-h-full lg:grid-cols-[300px_1fr]">
      {/* The way through, down the side */}
      <aside className="hidden flex-col border-r border-line bg-side px-7 py-7 lg:flex">
        <Logo />
        <div className="mt-12 text-[12.5px] text-dim">Activating</div>
        <div className="display mt-1 text-[20px] font-semibold leading-tight text-fg">{business.name}</div>
        <ol className="mt-8">
          {steps.map((s, n) => {
            const now = !submitted && s === at
            const done = submitted || (s !== 'review' && d.visited.includes(s) && s !== at && !gaps.some((g) => g.step === s))
            const still = submitted || s === 'review' || s === at || !d.visited.includes(s) ? [] : gaps.filter((g) => g.step === s)
            return (
              <li key={s} className="relative pb-5 last:pb-0">
                {n < steps.length - 1 && <span className={cx('absolute left-[11px] top-7 h-[calc(100%-24px)] w-px', done ? 'bg-fg/40' : 'bg-line')} />}
                <button
                  disabled={submitted || (s !== 'setup' && !d.kind)}
                  onClick={() => go(s)}
                  className="group flex w-full items-start gap-3 text-left disabled:cursor-default"
                >
                  <span
                    className={cx(
                      'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full transition',
                      done ? 'bg-lime text-fg' : now ? 'border-2 border-fg bg-card' : still.length ? 'border-2 border-[#D98E1F] bg-card text-[#A4600B]' : 'border border-dashed border-[#BDB9AE] bg-side',
                    )}
                  >
                    {done ? <Check className="size-3.5" strokeWidth={3} /> : now ? <span className="size-2 rounded-full bg-fg" /> : still.length ? <span className="text-[12px] font-bold leading-none">!</span> : null}
                  </span>
                  <span>
                    <span className={cx('block text-[14px]', now ? 'font-semibold text-fg' : done ? 'font-medium text-fg' : 'text-muted group-hover:text-fg')}>
                      {s === 'you' && d.kind === 'registered' ? 'Account representative' : s === 'people' && d.structure ? PEOPLE[d.structure].title : STEP_META[s].title}
                    </span>
                    {still.length ? (
                      <span className="mt-0.5 block text-[12.5px] leading-snug text-[#A4600B]">
                        Still needed: {still[0]!.label.toLowerCase()}
                        {still.length > 1 ? ` and ${still.length - 1} more` : ''}
                      </span>
                    ) : (
                      <span className="mt-0.5 block text-[12.5px] leading-snug text-dim">{STEP_META[s].sub}</span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
        <div className="mt-auto pt-10 text-[12.5px] leading-relaxed text-dim">
          Stuck on something? Ask us in the chat, a real person answers.
        </div>
      </aside>

      <div className="flex min-h-full flex-col bg-card">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5 sm:px-8">
          <span className="lg:hidden">
            <Logo />
          </span>
          <span className="hidden text-[13px] text-dim lg:block">
            {submitted ? (
              'Submitted'
            ) : (
              <>
                Step {i + 1} of {steps.length}
                <span className="ml-4">
                  <span className="text-red">*</span> required
                </span>
              </>
            )}
          </span>
          <Link to="/dashboard" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13.5px] font-medium text-muted hover:bg-raise hover:text-fg">
            <X className="size-4" /> Close
          </Link>
        </header>
        <div className="h-1 bg-raise lg:hidden">
          <div className="h-full bg-lime transition-all" style={{ width: `${submitted ? 100 : ((i + 1) / steps.length) * 100}%` }} />
        </div>

        <main className="rise mx-auto w-full max-w-[600px] flex-1 px-5 py-10 sm:py-14" key={submitted ? 'done' : at}>
          {submitted ? (
            <Submitted name={business.name} email={user?.email ?? ''} merchantId={business.merchantId} submittedAt={live?.application.submittedAt ?? null} onDashboard={() => navigate('/dashboard')} />
          ) : (
            <>
              {live?.application.status === 'CHANGES_REQUESTED' && live.application.decisionNote && (
                <div className="mb-9 rounded-xl border border-[#EBD3A6] bg-[#FDF6E7] p-5">
                  <div className="text-[14px] font-semibold text-[#5A3808]">Our team asked for a change</div>
                  <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-[#6E440A]">{live.application.decisionNote}</p>
                  <p className="mt-2 text-[12.5px] text-[#6E440A]">Everything else you sent is kept. Change what's needed, then submit again.</p>
                </div>
              )}
              {at === 'setup' && <SetupStep d={d} set={set} first={user?.first} onNext={next} />}
              {at === 'business' && <BusinessStep d={d} set={set} onBack={back} onNext={next} />}
              {at === 'documents' && <DocumentsStep d={d} set={set} live={live} onBack={back} onNext={next} />}
              {at === 'you' && <YouStep d={d} set={set} me={me} email={user?.email ?? ''} live={live} onBack={back} onNext={next} />}
              {at === 'people' && <PeopleStep d={d} set={set} me={me.name} live={live} onBack={back} onNext={next} />}
              {at === 'product' && <ProductStep d={d} set={set} onBack={back} onNext={next} />}
              {at === 'payout' && <PayoutStep d={d} set={set} me={me.name} live={live} onBack={back} onNext={next} />}
              {at === 'review' && <ReviewStep d={d} set={set} me={me} gaps={gaps} go={go} live={live} busy={busy} problem={problem} onBack={back} onSubmit={submit} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

/* ─── Pieces every step shares ─────────────────────────────────────── */

type StepProps = { d: Draft; set: (p: Partial<Draft>) => void; live?: LiveApp | null; onBack?: () => void; onNext?: () => void }

function Head({ title, sub }: { title: ReactNode; sub: ReactNode }) {
  return (
    <>
      <h1 className="display text-[32px] font-bold leading-[1.05] text-fg">{title}</h1>
      <p className="mt-2.5 text-[15px] leading-relaxed text-muted">{sub}</p>
    </>
  )
}

function Group({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <section className="mt-9 first:mt-8">
      <div className="mb-4 border-b border-line pb-2 text-[12.5px] font-semibold text-dim">
        {label}
        {required && <span className="ml-0.5 text-red" aria-hidden="true">*</span>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

/** The way on sits under the questions, where the eye already is. */
function Actions({ onBack, onNext, label = 'Save and continue', disabled }: { onBack?: () => void; onNext?: () => void; label?: string; disabled?: boolean }) {
  return (
    <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
      <div>
        {onBack && (
          <Button onClick={onBack} icon={<ArrowLeft className="size-4" />}>
            Back
          </Button>
        )}
      </div>
      <div className="flex items-center gap-4">
        <Link to="/dashboard" className="text-[13.5px] font-medium text-muted underline-offset-4 hover:text-fg hover:underline">
          Save and finish later
        </Link>
        <Button variant="primary" size="lg" onClick={onNext} disabled={disabled}>
          {label} <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function Address({ street, city, state, onChange, label }: { street: string; city: string; state: string; onChange: (p: { street?: string; city?: string; state?: string }) => void; label: string }) {
  return (
    <>
      <Field label={label} required>
        <Input value={street} onChange={(e) => onChange({ street: e.target.value })} placeholder="House number and street" />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="City" required>
          <Input value={city} onChange={(e) => onChange({ city: e.target.value })} placeholder="Benin City" />
        </Field>
        <Field label="State" required>
          <Select value={state} onChange={(e) => onChange({ state: e.target.value })}>
            <option value="">Select state</option>
            {NG_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </div>
    </>
  )
}

const MAX_UPLOAD = 10 * 1024 * 1024

function Dropzone({
  label,
  hint,
  optional,
  required,
  file,
  verdict,
  onPick,
  onClear,
}: {
  label: string
  hint?: string
  optional?: boolean
  required?: boolean
  file?: string
  /** Live: what our team said about it. */
  verdict?: { verdict: 'ACCEPTED' | 'REJECTED' | null; verdictNote: string | null }
  onPick: (file: File) => Promise<void> | void
  onClear: () => Promise<void> | void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pick = async (f: File) => {
    setError('')
    if (f.size > MAX_UPLOAD) return setError('That file is over 10 MB. Send a smaller scan or photo.')
    setBusy(true)
    try {
      await onPick(f)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That file didn't upload. Try again.")
    } finally {
      setBusy(false)
      if (ref.current) ref.current.value = ''
    }
  }
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-medium text-fg">
        {label}
        {required && <span className="ml-0.5 text-red" aria-hidden="true">*</span>}
        {optional && <span className="ml-1 font-normal text-dim">optional</span>}
      </div>
      {busy ? (
        <div className="flex items-center gap-3 rounded-[10px] border border-line bg-raise p-4 text-[13.5px] text-muted">
          <Loader2 className="size-5 animate-spin" /> Uploading…
        </div>
      ) : file ? (
        <div className={cx('flex items-center gap-3 rounded-[10px] border p-4', verdict?.verdict === 'REJECTED' ? 'border-[#EFC4C0] bg-[#FBEAE8]' : 'border-fg bg-[#F3FBE6]')}>
          <FileText className={cx('size-5', verdict?.verdict === 'REJECTED' ? 'text-red' : 'text-accent')} />
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{file}</span>
          {verdict?.verdict === 'REJECTED' && (
            <button onClick={() => ref.current?.click()} className="shrink-0 text-[12.5px] font-medium text-fg underline underline-offset-2">
              Send a new one
            </button>
          )}
          <button
            onClick={() => {
              setError('')
              Promise.resolve(onClear()).catch((e) => setError(e instanceof ApiError ? e.message : "That didn't work. Try again."))
            }}
            className="p-1 text-dim hover:text-red"
            aria-label="Remove file"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => ref.current?.click()}
          className="flex w-full items-center gap-4 rounded-[10px] border border-dashed border-[#CFCCC3] px-5 py-5 text-left transition hover:bg-raise"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-raise text-muted">
            <Upload className="size-[18px]" />
          </span>
          <span>
            <span className="block text-[13.5px] font-medium text-fg">Choose a file or drag it here</span>
            <span className="mt-0.5 block text-[12px] text-dim">JPEG, PNG or PDF, up to 10 MB</span>
          </span>
        </button>
      )}
      {verdict?.verdict === 'REJECTED' && verdict.verdictNote && <div className="mt-1.5 text-[12.5px] leading-relaxed text-red">Our team: {verdict.verdictNote}</div>}
      {error && <div className="mt-1.5 text-[12.5px] leading-relaxed text-red">{error}</div>}
      {hint && <div className="mt-1.5 text-[12.5px] leading-relaxed text-dim">{hint}</div>}
      <input
        ref={ref}
        type="file"
        className="hidden"
        accept=".jpg,.jpeg,.png,.pdf"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void pick(f)
        }}
      />
    </div>
  )
}

/* ─── 1. How you're set up ─────────────────────────────────────────── */

function SetupStep({ d, set, first, onNext }: StepProps & { first?: string }) {
  return (
    <>
      <Head
        title={first ? `${first}, welcome to Money Moves Business` : 'Welcome to Money Moves Business'}
        sub="Who are you taking payments for? It decides what we ask next."
      />
      <div className="mt-8 grid gap-3">
        <OptionCard
          selected={d.kind === 'individual'}
          onClick={() => set({ kind: 'individual' })}
          icon={<UserRound className="size-[18px]" />}
          title="Just me"
          sub="I sell as myself, a freelancer, a creator, or a business that isn't registered yet."
        />
        <OptionCard
          selected={d.kind === 'registered'}
          onClick={() => set({ kind: 'registered' })}
          icon={<Building2 className="size-[18px]" />}
          title="A registered business"
          sub="Registered with CAC, a business name, a company or incorporated trustees, with the documents to show it."
        />
      </div>
      <div className="mt-5 flex gap-2.5 text-[13px] leading-relaxed text-dim">
        <Info className="mt-0.5 size-4 shrink-0" />
        Both take every payment method. Register later and you can move this account over without starting again.
      </div>
      <Actions onNext={onNext} label="Continue" disabled={!d.kind} />
    </>
  )
}

/* ─── 2. Business details (registered) ─────────────────────────────── */

function BusinessStep({ d, set, onBack, onNext }: StepProps) {
  const s = d.structure
  return (
    <>
      <Head title="Business details" sub="Exactly as on your CAC record. We check them against it." />
      <Group label="How it's registered" required>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {(Object.keys(STRUCTURES) as Structure[]).map((k) => (
            <OptionCard key={k} selected={s === k} onClick={() => set({ structure: k })} title={STRUCTURES[k].label} sub={STRUCTURES[k].sub} />
          ))}
        </div>
      </Group>
      <Group label="Registration">
        <Field label="Registered business name" required>
          <Input value={d.legalName} onChange={(e) => set({ legalName: e.target.value })} placeholder="As it appears on the certificate" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Registration number" required hint={`Include the prefix, ${s ? STRUCTURES[s].prefix : 'RC, BN or IT'}1234567.`}>
            <Input value={d.regNumber} onChange={(e) => set({ regNumber: e.target.value.toUpperCase() })} placeholder={`${s ? STRUCTURES[s].prefix : 'RC'}1234567`} />
          </Field>
          <Field label="Date of registration" required>
            <Input type="date" value={d.regDate} onChange={(e) => set({ regDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Tax ID (TIN)" optional>
          <Input value={d.tin} onChange={(e) => set({ tin: e.target.value })} placeholder="12345678-0001" />
        </Field>
      </Group>
      <Group label="Address">
        <Address
          label="Registered address"
          street={d.bizStreet}
          city={d.bizCity}
          state={d.bizState}
          onChange={(p) => set({ ...(p.street !== undefined && { bizStreet: p.street }), ...(p.city !== undefined && { bizCity: p.city }), ...(p.state !== undefined && { bizState: p.state }) })}
        />
      </Group>
      <Group label="Industry">
        <Field label="What the business does" required>
          <Select value={d.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">Choose an industry</option>
            {INDUSTRIES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
        </Field>
      </Group>
      <Actions onBack={onBack} onNext={onNext} />
    </>
  )
}

/* ─── 3. Documents (registered) ────────────────────────────────────── */

function DocumentsStep({ d, set, live, onBack, onNext }: StepProps) {
  const list = d.structure ? DOCS[d.structure] : []
  return (
    <>
      <Head title="Documents" sub="Someone on our team reads each one, so a clear photo or scan is enough." />
      {list.length === 0 ? (
        <div className="mt-8 rounded-[10px] border border-line bg-raise p-5 text-[13.5px] text-muted">
          Pick how the business is registered first. The documents depend on it.
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          {list.map((doc) => (
            <Dropzone
              key={doc.id}
              label={doc.label}
              required
              hint={doc.hint}
              file={d.docs[doc.id]}
              verdict={live?.documents.find((x) => x.kind === doc.id)}
              onPick={(file) => (live ? live.upload(doc.id, file) : set({ docs: { ...d.docs, [doc.id]: file.name } }))}
              onClear={() => (live ? live.remove(doc.id) : set({ docs: Object.fromEntries(Object.entries(d.docs).filter(([k]) => k !== doc.id)) }))}
            />
          ))}
        </div>
      )}
      <Actions onBack={onBack} onNext={onNext} />
    </>
  )
}

/* ─── 4. You: the account representative ───────────────────────────── */

function YouStep({ d, set, me, email, live, onBack, onNext }: StepProps & { me: ReturnType<typeof diditRead>; email: string }) {
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const registered = d.kind === 'registered'
  const role = d.structure ? PEOPLE[d.structure] : PEOPLE.LTD
  const id = live?.identity
  const status = id?.status
  const partnerUnderWay = !!id && id.method !== 'manual' && (status === 'PENDING' || status === 'IN_REVIEW')
  const manual = !!live && (id?.method === 'manual' || (live.identityMethod === 'manual' && !partnerUnderWay && status !== 'APPROVED'))
  // Live, while Didit is still deciding, ask again every few seconds.
  useEffect(() => {
    if (!live?.identityReady || manual || (status !== 'PENDING' && status !== 'IN_REVIEW')) return
    const t = setInterval(() => void live.refreshIdentity().catch(() => {}), 8000)
    return () => clearInterval(t)
  }, [live?.identityReady, status]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<void>) => {
    setWorking(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
    } finally {
      setWorking(false)
    }
  }
  // Live: what the card says, from Didit's real decision.
  const card = !live || manual
    ? null
    : !live.identityReady
      ? { title: 'Identity checks open soon', sub: "They're being switched on. Fill in everything else meanwhile. We'll email you when you can do this step.", action: null }
      : status === 'APPROVED'
        ? null
        : status === 'IN_REVIEW'
          ? { title: 'Your check is being reviewed', sub: 'Usually a few minutes. You can carry on. This updates by itself.', action: 'refresh' as const }
          : status === 'DECLINED'
            ? { title: "We couldn't verify you", sub: 'Use a valid ID, photographed flat and in good light, and keep your face clear for the selfie. Then try again.', action: 'start' as const }
            : status === 'PENDING'
              ? {
                  title: 'Your identity check is started',
                    sub: "That's enough to carry on and submit. Our team sees the result before approving. If it hasn't gone through, we'll ask you to finish it.",
                    action: 'resume' as const,
                  }
              : { title: 'Verify your ID with a selfie', sub: "Photograph your ID, national ID card, driver's licence, voter's card or passport. Then take a short selfie video. We check the ID is genuine and that it's you.", action: 'start' as const }
  return (
    <>
      <Head
        title={registered ? 'Account representative' : 'Your identity'}
        sub={registered ? 'The person opening this account. Only you are checked now, nobody else on the filing.' : "Who's behind the account. It takes about two minutes."}
      />

      {/* Manual checks: photos from a phone (or this computer), checked before approval. */}
      {manual && live && status !== 'APPROVED' && (
        <div className="mt-8">
          <ManualIdentity path={live.path} identity={id ?? null} ids={live.identityIds} reload={live.reloadApp} canManage={live.canManage} />
        </div>
      )}

      {/* Live: the real identity check, and its real decision. */}
      {card && (
        <div className="mt-8 overflow-hidden rounded-xl border border-line">
          <div className="flex items-start gap-4 p-5">
            <span className={cx('flex size-11 shrink-0 items-center justify-center rounded-lg', status === 'DECLINED' ? 'bg-[#FBEAE8] text-red' : 'bg-[#143021] text-[#B4F25A]')}>
              <Fingerprint className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold text-fg">{card.title}</span>
                {status === 'PENDING' && <Badge tone="warn">In progress</Badge>}
                {status === 'IN_REVIEW' && <Badge tone="info">Being reviewed</Badge>}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{card.sub}</p>
              {card.action && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {(card.action === 'start' || card.action === 'resume') && (
                    <Button variant="primary" disabled={working} onClick={() => void run(() => live!.startIdentity())}>
                      {working ? 'Opening…' : card.action === 'resume' ? 'Resume the check' : status === 'DECLINED' ? 'Try again' : 'Start the check'}
                    </Button>
                  )}
                  {(card.action === 'refresh' || card.action === 'resume') && (
                    <Button disabled={working} onClick={() => void run(() => live!.refreshIdentity())}>
                      {card.action === 'resume' ? "I've finished. Check now" : 'Check now'}
                    </Button>
                  )}
                </div>
              )}
              {error && <p className="mt-3 text-[13px] text-red">{error}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 border-t border-line px-5 py-2.5 text-[12px] text-dim">
            <Lock className="size-3.5" /> Secure and private · your selfie is used only for this check
          </div>
        </div>
      )}

      {/* Approved (live), or the preview's sample card: the only check that happens before review. */}
      {(!live || status === 'APPROVED') && (
      <div className={cx('mt-8 overflow-hidden rounded-xl border', d.didit === 'done' ? 'border-fg' : 'border-line')}>
        <div className="flex items-start gap-4 p-5">
          <span className={cx('flex size-11 shrink-0 items-center justify-center rounded-lg', d.didit === 'done' ? 'bg-lime text-fg' : 'bg-[#143021] text-[#B4F25A]')}>
            {d.didit === 'done' ? <Check className="size-5" strokeWidth={3} /> : <Fingerprint className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold text-fg">{d.didit === 'done' ? 'Identity verified' : 'Verify your ID with a selfie'}</span>
              {d.didit === 'running' && <Badge tone="warn">In progress</Badge>}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              {d.didit === 'done'
                ? id?.method === 'manual'
                  ? 'Your ID checked out and your face matched it. Nothing more to do here.'
                  : 'Your ID checked out and your face matched it. Your name and date of birth come from it, so there is nothing to type.'
                : "Photograph your ID and take a short selfie video. We check the ID is genuine and that it's you."}
            </p>
            {!live && d.didit !== 'done' && (
              <Button variant="primary" className="mt-4" onClick={() => setOpen(true)}>
                About the identity check
              </Button>
            )}
          </div>
        </div>
        {d.didit === 'done' && id?.method !== 'manual' && (
          <div className="grid grid-cols-1 border-t border-line bg-raise text-[13px] sm:grid-cols-3">
            {[
              ['Name', me.name],
              ['Date of birth', me.dob],
              ['ID number', me.nin],
            ].map(([l, v]) => (
              <div key={l} className="border-b border-line px-5 py-3 last:border-0 sm:border-b-0 sm:border-r">
                <div className="text-[12px] text-dim">{l}</div>
                <div className="mt-0.5 font-medium text-fg">{v}</div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5 border-t border-line px-5 py-2.5 text-[12px] text-dim">
          <Lock className="size-3.5" /> Secure and private · your selfie is used only for this check
        </div>
      </div>
      )}

      <Group label="Contact">
        <Field label="Phone number" required>
          <div className="flex gap-2">
            <span className="flex h-10 items-center rounded-lg border border-line bg-raise px-3 text-[14px] text-muted">+234</span>
            <Input value={d.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="801 234 5678" inputMode="tel" />
          </div>
        </Field>
        <Field label="Email" hint="The one you signed up with.">
          <Input value={email} disabled />
        </Field>
        <Field label="Social profile" optional hint="Anything public that shows who you are, LinkedIn, X or Instagram.">
          <Input value={d.social} onChange={(e) => set({ social: e.target.value })} placeholder="https://" />
        </Field>
      </Group>

      <Group label="Home address">
        <Address
          label="Street"
          street={d.street}
          city={d.city}
          state={d.state}
          onChange={(p) => set({ ...(p.street !== undefined && { street: p.street }), ...(p.city !== undefined && { city: p.city }), ...(p.state !== undefined && { state: p.state }) })}
        />
        <Dropzone
          label="Proof of address"
          optional
          hint="A bill or bank statement from the last three months. Skip it now. We'll ask if we need it."
          file={d.proofOfAddress}
          verdict={live?.documents.find((x) => x.kind === 'proofOfAddress')}
          onPick={(file) => (live ? live.upload('proofOfAddress', file) : set({ proofOfAddress: file.name }))}
          onClear={() => (live ? live.remove('proofOfAddress') : set({ proofOfAddress: '' }))}
        />
      </Group>

      {registered && (
        <Group label="Your role">
          <Checkbox checked={d.repDirector} onChange={(v) => set({ repDirector: v })}>
            {role.me} of {d.legalName || 'this business'}
          </Checkbox>
          {(d.structure === 'LTD' || d.structure === 'PLC') && (
            <>
              <Checkbox checked={d.repOwner} onChange={(v) => set({ repOwner: v })}>
                I own 25% or more of it
              </Checkbox>
              {d.repOwner && (
                <div className="max-w-[180px] pl-6">
                  <Field label="Your share" required>
                    <Input value={d.repShare} onChange={(e) => set({ repShare: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="40 %" inputMode="decimal" />
                  </Field>
                </div>
              )}
            </>
          )}
        </Group>
      )}

      <div className="mt-8 flex gap-2.5 rounded-[10px] bg-raise p-4 text-[13px] leading-relaxed text-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-fg" />
        <span>
          <span className="font-medium text-fg">No BVN needed now.</span> If we need it later, it shows up as a task in Compliance. It won't hold your account up.
        </span>
      </div>

      <Actions onBack={onBack} onNext={onNext} />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="The identity check"
        sub="In the live dashboard this opens the secure identity check. The preview doesn't do identity checks. There's nothing to pretend here."
      >
        <ol className="space-y-3 rounded-[10px] border border-line bg-raise p-5 text-[13.5px] text-muted">
          {['Photograph your ID, front and back', 'Record a short selfie video', 'We check the ID is genuine and that the face is yours'].map((t, n) => (
            <li key={t} className="flex items-center gap-3">
              <span className="flex size-6 items-center justify-center rounded-full bg-card font-mono text-[11px] text-fg">{n + 1}</span>
              {t}
            </li>
          ))}
        </ol>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={() => setOpen(false)}>
            Got it
          </Button>
        </div>
      </Modal>
    </>
  )
}

/* ─── 5. The people on the filing (registered) ─────────────────────── */

function PeopleStep({ d, set, live, onBack, onNext }: StepProps & { me: string }) {
  const [editing, setEditing] = useState<Person | null>(null)
  const words = d.structure ? PEOPLE[d.structure] : PEOPLE.LTD
  const companyish = d.structure === 'LTD' || d.structure === 'PLC'
  const roles = (dir: boolean, own: boolean, share?: string) =>
    companyish ? [dir && 'Director', own && `Owner${share ? ` · ${share}%` : ''}`].filter(Boolean).join(', ') : words.role[0]!.toUpperCase() + words.role.slice(1)
  const save = (p: Person) => {
    const exists = d.people.some((x) => x.id === p.id)
    set({ people: exists ? d.people.map((x) => (x.id === p.id ? p : x)) : [...d.people, p] })
    setEditing(null)
  }

  return (
    <>
      <Head title={words.title} sub={`${words.sub} Include yourself if you're one of them. We don't check their IDs now. If we need anything from them later, you'll get a task.`} />
      <div className="mt-8 space-y-2.5">
        {d.people.map(asPerson).map((p) =>
          editing?.id === p.id ? null : (
            <div key={p.id} className="flex items-center gap-3 rounded-[10px] border border-line p-4">
              <span className="flex size-9 items-center justify-center rounded-full bg-raise text-[12px] font-semibold text-muted">
                {(p.first[0] ?? '?') + (p.last[0] ?? '')}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-semibold text-fg">{fullName(p) || 'Unnamed'}</span>
                  {(!personComplete(p, companyish) || !idDocsDone(p, d.docs)) && <Badge tone="warn">Details missing</Badge>}
                </div>
                <div className="truncate text-[12.5px] text-dim">
                  {roles(p.director, p.owner, p.share)} · {p.email || 'no email yet'}
                </div>
              </div>
              <button onClick={() => setEditing(p)} className="rounded-md p-2 text-dim hover:bg-raise hover:text-fg" aria-label="Edit">
                <Pencil className="size-4" />
              </button>
              <button onClick={() => set({ people: d.people.filter((x) => x.id !== p.id) })} className="rounded-md p-2 text-dim hover:bg-raise hover:text-red" aria-label="Remove">
                <Trash2 className="size-4" />
              </button>
            </div>
          ),
        )}
      </div>

      {editing ? (
        <PersonForm
          key={editing.id}
          initial={asPerson(editing)}
          companyish={companyish}
          docs={d.docs}
          verdictOf={(kind) => live?.documents.find((x) => x.kind === kind)}
          onPick={(kind, file) => (live ? live.upload(kind, file) : set({ docs: { ...d.docs, [kind]: file.name } }))}
          onClear={(kind) => (live ? live.remove(kind) : set({ docs: Object.fromEntries(Object.entries(d.docs).filter(([k]) => k !== kind)) }))}
          onDone={save}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button
          onClick={() => setEditing(blankPerson())}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-[#CFCCC3] py-4 text-[13.5px] font-medium text-fg transition hover:bg-raise"
        >
          <Plus className="size-4" /> Add a person
        </button>
      )}
      <Actions onBack={onBack} onNext={onNext} />
    </>
  )
}

function PersonForm({
  initial,
  companyish,
  docs,
  verdictOf,
  onPick,
  onClear,
  onDone,
  onCancel,
}: {
  initial: Person
  companyish: boolean
  docs: Record<string, string>
  verdictOf: (kind: string) => { verdict: 'ACCEPTED' | 'REJECTED' | null; verdictNote: string | null } | undefined
  onPick: (kind: string, file: File) => Promise<void> | void
  onClear: (kind: string) => Promise<void> | void
  onDone: (p: Person) => void
  onCancel: () => void
}) {
  const [p, setP] = useState(initial)
  const f = (k: keyof Person) => (e: { target: { value: string } }) => setP((x) => ({ ...x, [k]: e.target.value }))
  const nigeria = p.country === 'NG'
  const today = new Date().toISOString().slice(0, 10)
  const sub = 'mb-3 mt-6 text-[12.5px] font-semibold text-dim'
  return (
    <div className="rise mt-3 rounded-xl border border-fg p-5">
      <div className="text-[14px] font-semibold text-fg">{initial.first ? `Edit ${fullName(initial)}` : 'New person'}</div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="First name" required>
          <Input value={p.first} onChange={f('first')} autoFocus />
        </Field>
        <Field label="Last name" required>
          <Input value={p.last} onChange={f('last')} />
        </Field>
        <Field label="Date of birth" required>
          <Input type="date" value={p.dob} onChange={f('dob')} max={today} />
        </Field>
        <div className="hidden sm:block" />
        <Field label="Email" required>
          <Input type="email" value={p.email} onChange={f('email')} placeholder="name@example.com" />
        </Field>
        <Field label="Phone" required>
          <Input value={p.phone} onChange={f('phone')} placeholder="+234…" inputMode="tel" />
        </Field>
      </div>

      <div className={sub}>Their ID</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Issuing country" required>
          <Select value={p.idCountry} onChange={(e) => setP((x) => ({ ...x, idCountry: e.target.value, idType: '' }))}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ID type" required>
          <Select value={p.idType} onChange={f('idType')}>
            <option value="">Select their ID</option>
            {idTypesFor(p.idCountry).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
      </div>

      {p.idType && (
        <div className="mt-4 space-y-4">
          {((needsBack(p.idType) ? ['front', 'back'] : ['front']) as ('front' | 'back')[]).map((side) => (
            <Dropzone
              key={side}
              label={`${side === 'front' ? 'Front' : 'Back'} of their ${needsBack(p.idType) ? 'licence' : 'ID'}`}
              required
              hint={side === 'front' ? 'A clear photo or scan, all four corners in view.' : 'The other side, just as clear.'}
              file={docs[idDoc(p, side)]}
              verdict={verdictOf(idDoc(p, side))}
              onPick={(file) => onPick(idDoc(p, side), file)}
              onClear={() => onClear(idDoc(p, side))}
            />
          ))}
        </div>
      )}

      <div className={sub}>Where they live</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Address" required>
            <Input value={p.street} onChange={f('street')} placeholder="Street address" />
          </Field>
        </div>
        <Field label="Country" required>
          <Select value={p.country} onChange={(e) => setP((x) => ({ ...x, country: e.target.value, state: '' }))}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={nigeria ? 'State' : 'State or province'} required>
          {nigeria ? (
            <Select value={p.state} onChange={f('state')}>
              <option value="">Select state</option>
              {NG_STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          ) : (
            <Input value={p.state} onChange={f('state')} />
          )}
        </Field>
        <Field label="City" required>
          <Input value={p.city} onChange={f('city')} />
        </Field>
        <Field label="Postal code" required>
          <Input value={p.postal} onChange={f('postal')} placeholder={nigeria ? '100001' : undefined} />
        </Field>
      </div>

      {companyish && (
        <>
          <div className={sub}>
            Their role<span className="ml-0.5 text-red">*</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Checkbox checked={p.director} onChange={(v) => setP((x) => ({ ...x, director: v }))}>
              Director
            </Checkbox>
            <Checkbox checked={p.owner} onChange={(v) => setP((x) => ({ ...x, owner: v }))}>
              Owner
            </Checkbox>
            {p.owner && (
              <div className="w-[130px]">
                <Input value={p.share} onChange={(e) => setP((x) => ({ ...x, share: e.target.value.replace(/[^0-9.]/g, '') }))} placeholder="Share %*" inputMode="decimal" aria-label="Share they own, in percent" />
              </div>
            )}
          </div>
          {!p.director && !p.owner && <p className="mt-2 text-[12.5px] text-dim">Tick at least one.</p>}
        </>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={!personComplete(p, companyish) || !idDocsDone(p, docs)} onClick={() => onDone(p)}>
          Save person
        </Button>
      </div>
    </div>
  )
}

/* ─── 6. What you sell ─────────────────────────────────────────────── */

function ProductStep({ d, set, onBack, onNext }: StepProps) {
  const n = d.description.trim().length
  const words = wordsIn(d.description)
  const individual = d.kind !== 'registered'
  // Saved answers can lack some of them.
  const socials = Object.assign({ instagram: '', x: '', tiktok: '', facebook: '' }, d.socials)
  const social = (k: keyof typeof socials) => (e: { target: { value: string } }) => set({ socials: { ...socials, [k]: e.target.value.trim() } })
  return (
    <>
      <Head title="What you sell" sub="So our team can see it's real, and so customers know who they're paying." />
      <Group label="Your product">
        <Field label={individual ? 'Website' : 'Business website'} optional hint="Where customers can see and buy what you sell. Coming-soon and link-in-bio pages don't help us much.">
          <Input value={d.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://" />
        </Field>
        {individual && (
          <Field label="What you do" required>
            <Select value={d.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">Choose a category</option>
              {INDUSTRIES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field
          label="Describe it"
          required
          aside={
            n < MIN_CHARS ? (
              <span className="tabular text-[12px] text-dim">{MIN_CHARS - n} more characters</span>
            ) : (
              <span className={cx('tabular text-[12px]', words > MAX_WORDS ? 'text-red' : 'text-dim')}>
                {words} / {MAX_WORDS} words
              </span>
            )
          }
          error={words > MAX_WORDS ? `Keep it to ${MAX_WORDS} words, ${words - MAX_WORDS} over.` : undefined}
          hint={`What you sell, who buys it, and how they pay you today. At least ${MIN_CHARS} characters, up to ${MAX_WORDS} words.`}
        >
          <Textarea value={d.description} onChange={(e) => set({ description: e.target.value })} className="min-h-[160px]" placeholder="We sell…" />
        </Field>
        <Field label="Expected monthly volume" optional hint="Helps us set your limits right from day one.">
          <Select value={d.volume} onChange={(e) => set({ volume: e.target.value })}>
            <option value="">Choose a range</option>
            <option>Under ₦1 million</option>
            <option>₦1m to ₦10m</option>
            <option>₦10m to ₦50m</option>
            <option>Over ₦50 million</option>
          </Select>
        </Field>
      </Group>
      <Group label="Social pages">
        <p className="-mt-1 text-[13px] text-muted">Any that show your business, a link or your @handle. All optional.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Instagram" optional>
            <Input value={socials.instagram} onChange={social('instagram')} placeholder="@yourbusiness" />
          </Field>
          <Field label="X" optional>
            <Input value={socials.x} onChange={social('x')} placeholder="@yourbusiness" />
          </Field>
          <Field label="TikTok" optional>
            <Input value={socials.tiktok} onChange={social('tiktok')} placeholder="@yourbusiness" />
          </Field>
          <Field label="Facebook" optional>
            <Input value={socials.facebook} onChange={social('facebook')} placeholder="facebook.com/yourbusiness" />
          </Field>
        </div>
      </Group>
      {/* One way for customers to reach them is enough - an email or a phone, whichever they use. */}
      <Group label="Contact, a support email or phone, one is enough" required>
        <Field label="Support email" hint="Where customers can reach you.">
          <Input type="email" value={d.supportEmail} onChange={(e) => set({ supportEmail: e.target.value })} placeholder="support@yourbusiness.com" />
        </Field>
        <Field label="Support phone" hint="A number customers can call or message.">
          <div className="flex gap-2">
            <span className="flex h-10 items-center rounded-lg border border-line bg-raise px-3 text-[14px] text-muted">+234</span>
            <Input value={d.supportPhone ?? ''} onChange={(e) => set({ supportPhone: e.target.value })} placeholder="801 234 5678" inputMode="tel" />
          </div>
        </Field>
      </Group>
      <Actions onBack={onBack} onNext={onNext} />
    </>
  )
}

/* ─── 7. Getting paid ──────────────────────────────────────────────── */

function PayoutStep({ d, set, me, live, onBack, onNext }: StepProps & { me: string }) {
  const registered = d.kind === 'registered'
  const owner = registered ? d.legalName || 'your registered business name' : me
  const [checking, setChecking] = useState(false)
  const [adding, setAdding] = useState(false)
  const wallet = d.wallet ?? BLANK_WALLET
  const { business } = useSession()
  const [removing, setRemoving] = useState<string | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [bankError, setBankError] = useState('')

  // Taken off the list, never deleted: our records keep it, and anything already paid to it stays as it was.
  const removeBank = async (id: string) => {
    if (!business) return
    setRemoveBusy(true)
    setBankError('')
    try {
      await api('DELETE', `${bankAccountsPath(business.id)}/${id}`)
      await reload(bankAccountsPath(business.id))
      setRemoving(null)
    } catch (e) {
      setBankError(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
    } finally {
      setRemoveBusy(false)
    }
  }

  // Preview: a full account number "resolves" to the owner's name. Live, the bank says (Payout places).
  useEffect(() => {
    if (live || d.account.length !== 10 || !d.bank) return
    if (d.accountName) return
    setChecking(true)
    const t = setTimeout(() => {
      set({ accountName: (registered ? d.legalName || 'MOVERS DIGITAL TECHNOLOGIES LTD' : me).toUpperCase() })
      setChecking(false)
    }, 800)
    return () => clearTimeout(t)
  }, [d.account, d.bank]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Head
        title="Getting paid"
        sub={
          live
            ? registered
              ? 'Where your money lands. Each payment link, invoice and store QR settles to the place you choose for it.'
              : 'Where your money lands: a bank account, a Money Moves account, or both.'
            : registered
              ? "Where you can be paid to. You'll pick one of these for each store QR, payment link and invoice; API payments go to the first one that can take them, and you can pick one later."
              : 'Everything you take lands in your business wallet. Add your bank account so you can withdraw as naira whenever you like.'
        }
      />

      {live && (
        <p className="mt-6 text-[13px] text-muted">
          <span className="mr-0.5 text-red" aria-hidden="true">*</span> Add at least one: a bank account or a Money Moves account.
        </p>
      )}

      {live ? (
        <Group label="Bank account">
          {live.banks.length === 0 ? (
            <p className="text-[13.5px] text-muted">No bank account yet. The bank tells us whose account it is.</p>
          ) : (
            <div className="space-y-2">
              {live.banks.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-fg">{bankLabel(b)}</div>
                    <div className="truncate text-[12.5px] text-dim">{b.name}</div>
                  </div>
                  {removing === b.id ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[12.5px] text-muted">Remove it?</span>
                      <Button size="sm" variant="danger" disabled={removeBusy} onClick={() => void removeBank(b.id)}>
                        {removeBusy ? 'Removing…' : 'Remove'}
                      </Button>
                      <Button size="sm" disabled={removeBusy} onClick={() => setRemoving(null)}>
                        Keep
                      </Button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-2">
                      {b.verified ? <Badge tone="good">Verified</Badge> : b.declined ? <Badge tone="bad">Not approved</Badge> : <Badge tone="warn">Checking</Badge>}
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(b.id)} aria-label={`Remove ${bankLabel(b)}`}>
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {bankError && <p className="text-[12.5px] text-red">{bankError}</p>}
          <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
            {live.banks.length ? 'Add another' : 'Add a bank account'}
          </Button>
          <AddBankModal open={adding} onClose={() => setAdding(false)} first={live.banks.length === 0} owner={live.owner} onAdded={() => {}} />
        </Group>
      ) : (
      <Group label="Bank account" required>
        <Field label="Bank" required>
          <Select value={d.bank} onChange={(e) => set({ bank: e.target.value, accountName: '' })}>
            <option value="">Choose your bank</option>
            {BANKS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </Select>
        </Field>
        <Field label="Account number" required hint={`Must be in ${registered ? 'the registered business name' : 'your own name, as on your ID'}: ${owner}.`}>
          <Input value={d.account} onChange={(e) => set({ account: e.target.value.replace(/\D/g, '').slice(0, 10), accountName: '' })} placeholder="0123456789" inputMode="numeric" />
        </Field>
        <Field label="Account name">
          <div className={cx('flex h-10 items-center gap-2 rounded-[7px] border px-3 text-[14px]', d.accountName ? 'border-fg bg-[#F3FBE6] text-fg' : 'border-line bg-raise text-dim')}>
            {checking ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Checking the account…
              </>
            ) : d.accountName ? (
              <>
                <Check className="size-4 text-accent" strokeWidth={3} /> <span className="min-w-0 flex-1 truncate font-medium">{d.accountName}</span>
                <span className="hidden text-[12px] text-accent sm:inline">Name matches</span>
              </>
            ) : (
              'Filled in once we find the account'
            )}
          </div>
        </Field>
      </Group>
      )}

      {(registered || live) && (
        <Group label="Money Moves account">
          {live ? (
            <>
              <p className="-mt-1 text-[13px] text-muted">Payments land in the app instead of a bank. The account's owner approves the link in Money Moves.</p>
              <MoneyMovesLinker />
            </>
          ) : (
            <WalletTargetForm value={wallet} onChange={(w) => set({ wallet: w })} />
          )}
        </Group>
      )}

      {!live && (
      <>
      <div className="mt-6 flex gap-3 rounded-[10px] border border-line bg-raise p-4 text-[13px] leading-relaxed text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-fg" />
        <span>
          <span className="font-medium text-fg">Your business wallet is created the moment you're approved.</span> It's self-custody, API
          payments land there, and you refund customers or withdraw from it yourself.
        </span>
      </div>

      <div className="mt-8">
        <div className="mb-2.5 text-[12.5px] font-semibold text-dim">How each payment settles</div>
        <ChannelSettlement individual={!registered} />
      </div>

      <div className="mt-5 flex gap-2.5 text-[13px] leading-relaxed text-dim">
        <Lock className="mt-0.5 size-4 shrink-0" />
        Naira withdrawals go only to your own bank account for now. Paying suppliers and staff switches on later.
      </div>
      </>
      )}
      <Actions onBack={onBack} onNext={onNext} />
    </>
  )
}

/* ─── 8. Review and submit ─────────────────────────────────────────── */

function ReviewStep({
  d,
  set,
  me,
  gaps,
  go,
  live,
  busy,
  problem,
  onBack,
  onSubmit,
}: StepProps & { me: ReturnType<typeof diditRead>; gaps: { step: StepId; label: string }[]; go: (s: StepId) => void; busy?: boolean; problem?: string; onSubmit: () => void }) {
  const registered = d.kind === 'registered'
  const dash = (v: string | undefined | null) => v || '—'
  const sections: { step: StepId; title: string; rows: [string, ReactNode][] }[] = [
    ...(registered
      ? [
          {
            step: 'business' as StepId,
            title: 'Business details',
            rows: [
              ['Structure', d.structure ? STRUCTURES[d.structure].label : '—'],
              ['Registered name', dash(d.legalName)],
              ['Registration number', dash(d.regNumber)],
              ['Address', [d.bizStreet, d.bizCity, d.bizState].filter(Boolean).join(', ') || '—'],
              ['Industry', dash(d.category)],
            ] as [string, ReactNode][],
          },
          {
            step: 'documents' as StepId,
            title: 'Documents',
            rows: (d.structure ? DOCS[d.structure] : []).map((doc) => [doc.label, d.docs[doc.id] ?? '—'] as [string, ReactNode]),
          },
        ]
      : []),
    {
      step: 'you',
      title: registered ? 'Account representative' : 'Your identity',
      rows: [
        [
          'Identity check',
          live ? (
            live.identity?.status === 'APPROVED' ? (
              <Badge tone="good" key="v">ID and selfie verified</Badge>
            ) : live.identity?.status === 'IN_REVIEW' ? (
              <Badge tone="info" key="v">Being reviewed</Badge>
            ) : live.identity?.status === 'PENDING' ? (
              <Badge tone="info" key="v">Started. Our team sees the result</Badge>
            ) : live.identity?.status === 'DECLINED' ? (
              'Declined. Do it again'
            ) : (
              'Not done'
            )
          ) : (
            'Done in the live dashboard'
          ),
        ],
        ['Name', d.didit === 'done' ? me.name : '—'],
        ['Phone', d.phone ? `+234 ${d.phone}` : '—'],
        ['Home address', [d.street, d.city, d.state].filter(Boolean).join(', ') || '—'],
      ],
    },
    ...(registered && d.structure
      ? [
          {
            step: 'people' as StepId,
            title: PEOPLE[d.structure].title,
            rows: [
              ...d.people.map(asPerson).map((p) => [fullName(p) || 'Unnamed', p.email || '—'] as [string, ReactNode]),
            ],
          },
        ]
      : []),
    {
      step: 'product',
      title: 'What you sell',
      rows: [
        ['Website', d.website || 'Not given, optional'],
        ['Social pages', Object.values(d.socials ?? {}).filter(Boolean).join(' · ') || 'Not given, optional'],
        ['Description', d.description ? `${d.description.slice(0, 60)}${d.description.length > 60 ? '…' : ''}` : '—'],
        ['Support email', dash(d.supportEmail)],
        ['Support phone', d.supportPhone ? `+234 ${d.supportPhone}` : '—'],
      ],
    },
    {
      step: 'payout',
      title: 'Getting paid',
      rows: [
        ['Bank account', live ? live.banks.map((b) => bankLabel(b)).join(', ') || 'Not added' : d.accountName ? `${d.bank} · ${d.account} · ${d.accountName}` : '—'],
        ...(live
          ? [['Money Moves account', live.mms.length ? live.mms.map((m) => `${m.username}${m.linked ? '' : ' (waiting for approval)'}`).join(', ') : 'Not added'] as [string, ReactNode]]
          : registered
            ? [['Money Moves account', d.wallet?.username ? d.wallet.username : 'Not added, optional'] as [string, ReactNode]]
            : []),
        ...(live ? [] : [['API payments', 'Automatic (you can change this later)'] as [string, ReactNode]]),
      ],
    },
  ]

  return (
    <>
      <Head title="Review and submit" sub="One last look. Our team reviews everything by hand, usually within one working day." />
      <div className="mt-8 space-y-3">
        {sections.map((s) => {
          const short = gaps.filter((g) => g.step === s.step).length
          return (
            <div key={s.step} className="overflow-hidden rounded-xl border border-line">
              <div className="flex items-center justify-between gap-3 bg-raise px-5 py-3">
                <span className="flex items-center gap-2 text-[14px] font-semibold text-fg">
                  {s.title}
                  {short > 0 ? <Badge tone="warn">{short} missing</Badge> : <Check className="size-4 text-accent" strokeWidth={3} />}
                </span>
                <button onClick={() => go(s.step)} className="flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg">
                  <Pencil className="size-3.5" /> Edit
                </button>
              </div>
              <div className="px-5 py-1">
                {s.rows.length === 0 ? (
                  <div className="py-3 text-[13px] text-dim">Nothing yet.</div>
                ) : (
                  s.rows.map(([l, v]) => (
                    <div key={l} className="flex items-start justify-between gap-6 border-b border-soft py-2.5 text-[13px] last:border-0">
                      <span className="shrink-0 text-dim">{l}</span>
                      <span className="min-w-0 break-words text-right text-fg">{v}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {gaps.length > 0 && (
        <div className="mt-6 rounded-xl border border-[#EBD3A6] bg-[#FDF6E7] p-5">
          <div className="text-[14px] font-semibold text-[#5A3808]">
            {gaps.length} {gaps.length === 1 ? 'thing' : 'things'} to finish before you submit
          </div>
          <ul className="mt-3 space-y-1.5">
            {gaps.map((g) => (
              <li key={g.label}>
                <button onClick={() => go(g.step)} className="group flex items-center gap-2 text-left text-[13px] text-[#6E440A]">
                  <span className="size-1.5 rounded-full bg-[#D98E1F]" />
                  <span className="underline-offset-2 group-hover:underline">{g.label}</span>
                  <ArrowRight className="size-3.5 opacity-0 transition group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <Checkbox checked={d.attest} onChange={(v) => set({ attest: v })}>
          I confirm these details are true, that I'm allowed to open this account{registered ? ' for the business' : ''}, and I accept the{' '}
          <a href="#" className="font-medium text-fg underline underline-offset-2">merchant agreement</a>.
        </Checkbox>
      </div>
      {problem && <p className="mt-5 text-[13.5px] text-red">{problem}</p>}
      <Actions onBack={onBack} onNext={onSubmit} label={busy ? 'Submitting…' : 'Submit for review'} disabled={gaps.length > 0 || !d.attest || busy} />
    </>
  )
}

/* ─── Sent ─────────────────────────────────────────────────────────── */

const when = (d: Date) => d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * After submitting: where the application stands and what comes next, said
 * plainly. A status, the facts of what was sent, and the steps ahead - the
 * one in progress marked - rather than a celebration.
 */
function Submitted({ name, email, merchantId, submittedAt, onDashboard }: { name: string; email: string; merchantId?: string; submittedAt?: string | null; onDashboard: () => void }) {
  const sent = submittedAt ? new Date(submittedAt) : new Date()
  const steps: { title: string; detail: string; state: 'done' | 'now' | 'next'; at?: string }[] = [
    { title: 'Submitted', detail: 'Your details, documents and identity check are in.', state: 'done', at: when(sent) },
    { title: 'In review', detail: 'Our review team checks everything against your ID and the CAC record.', state: 'now' },
    { title: 'Approved', detail: 'Live mode and live API keys switch on, and your business wallet is created.', state: 'next' },
  ]
  return (
    <div>
      <span className="inline-flex items-center gap-2 rounded-full border border-[#EBD3A6] bg-[#FDF6E7] px-2.5 py-1 text-[12px] font-medium text-[#6E440A]">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#D98E1F] opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-[#D98E1F]" />
        </span>
        In review
      </span>
      <h1 className="mt-4 text-[26px] font-semibold leading-tight tracking-[-0.01em] text-fg">Application submitted</h1>
      <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
        Our review team usually responds within 24 hours. We'll email <span className="font-medium text-fg">{email}</span> when there's an update.
      </p>

      <dl className="mt-7 divide-y divide-line rounded-xl border border-line text-[13.5px]">
        {[
          ['Business', name],
          ...(merchantId ? [['Merchant ID', merchantId]] : []),
          ['Submitted', when(sent)],
          ['Status', 'In review'],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-dim">{k}</dt>
            <dd className={cx('min-w-0 truncate text-right text-fg', k === 'Merchant ID' && 'font-mono text-[13px]')}>{v}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-9 text-[13px] font-semibold text-fg">What happens next</h2>
      <ol className="mt-4">
        {steps.map((st, i) => (
          <li key={st.title} className="relative flex gap-4 pb-6 last:pb-0">
            {i < steps.length - 1 && <span className={cx('absolute left-[11px] top-7 bottom-0 w-px', st.state === 'done' ? 'bg-fg/40' : 'bg-line')} />}
            <span
              className={cx(
                'relative mt-0.5 flex size-[23px] shrink-0 items-center justify-center rounded-full border',
                st.state === 'done' ? 'border-fg bg-fg text-white' : st.state === 'now' ? 'border-[#D98E1F] bg-card' : 'border-line bg-card',
              )}
            >
              {st.state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : st.state === 'now' ? <span className="size-2 rounded-full bg-[#D98E1F]" /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className={cx('text-[14px] font-semibold', st.state === 'next' ? 'text-muted' : 'text-fg')}>{st.title}</span>
                {st.at && <span className="text-[12px] text-dim">{st.at}</span>}
                {st.state === 'now' && <span className="text-[12px] text-dim">Usually within 24 hours</span>}
              </div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{st.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 rounded-lg bg-raise px-4 py-3 text-[12.5px] leading-relaxed text-muted">
        We may ask for more later, like a BVN. It appears as a task in Compliance and never pauses your account.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button variant="primary" size="lg" onClick={onDashboard}>
          Go to dashboard
        </Button>
        <Link to="/settings/compliance">
          <Button size="lg">See what's in review</Button>
        </Link>
      </div>
      <p className="mt-5 text-[13px] text-dim">Meanwhile, test mode is yours. Build your checkout and try the API.</p>
    </div>
  )
}
