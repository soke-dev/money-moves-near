/**
 * Switches for the whole of Money Moves Business. The API enforces every one
 * of them - a switch off here is off for every business within seconds - and
 * every save takes the action password.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { C, ago } from '../ui'
import { biz, BizError, useLoad, type Platform, type PlatformData } from './client'
import { Button, ListLoading, Notice, Panel, PasswordInput, PLEX, Problem, Said, Tabs, Tag, useAction } from './kit'

/** An on/off switch: lime when on. */
function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors"
      style={{ background: on ? C.lime : C.raise, border: `1px solid ${on ? C.lime : '#2A3122'}` }}
    >
      <span className="absolute top-[2px] h-4 w-4 rounded-full transition-all" style={{ left: on ? 18 : 2, background: on ? '#0A0C08' : C.muted }} />
    </button>
  )
}

function Row({ label, sub, changed, later, children }: { label: string; sub?: string; changed?: boolean; later?: string | null; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-medium" style={{ color: C.text }}>
            {label}
          </span>
          {later && <Tag>Not live yet</Tag>}
          {changed && <Tag tone="warn">Changed</Tag>}
        </div>
        {sub && (
          <div className="mt-0.5 text-[12.5px] leading-relaxed" style={{ color: C.dim }}>
            {sub}
          </div>
        )}
        {later && (
          <div className="mt-0.5 text-[12.5px] leading-relaxed" style={{ color: C.amber }}>
            {later}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

/** One switch, with what it does. "Not live yet", with why, marks a switch for something that can't work live yet. */
export function SwitchRow({ label, sub, on, onChange, later, changed }: { label: string; sub?: string; on: boolean; onChange: (v: boolean) => void; later?: string | null; changed?: boolean }) {
  return (
    <Row label={label} sub={sub} later={later} changed={changed}>
      <Switch on={on} onChange={onChange} label={label} />
    </Row>
  )
}

/** A number box for a fee or a limit, with its unit. */
function NumberRow({ label, sub, value, onChange, unit, changed }: { label: string; sub?: string; value: number; onChange: (v: number) => void; unit: string; changed?: boolean }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <Row label={label} sub={sub} changed={changed}>
      <div className="flex shrink-0 items-center gap-1.5">
        <input
          value={text}
          inputMode="decimal"
          aria-label={label}
          onChange={(e) => {
            const t = e.target.value.replace(/[^0-9.]/g, '')
            setText(t)
            const n = Number(t)
            if (t !== '' && Number.isFinite(n)) onChange(n)
          }}
          className="h-9 w-[104px] rounded-lg border border-[#262C1F] bg-[#181C14] px-3 text-right text-[13.5px] text-[#ECEFE7] outline-none focus:border-[#4C7A17]"
          style={{ fontFamily: PLEX }}
        />
        <span className="w-6 text-[12.5px]" style={{ color: C.dim }}>
          {unit}
        </span>
      </div>
    </Row>
  )
}

function Group({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <Panel title={title} sub={sub} flush>
      <div className="-mt-px">{children}</div>
    </Panel>
  )
}

type Tab = 'switches' | 'pay' | 'checkouts' | 'settle' | 'fees' | 'limits'

export function Services() {
  const [tab, setTab] = useState<Tab>('switches')
  const { data, error, loading, reload } = useLoad<PlatformData>('/platform')
  const [draft, setDraft] = useState<Platform | null>(null)
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction(() => setPassword(''))
  // A refresh keeps unsaved switches; only a saved change (here or by someone else) resets them.
  const synced = useRef('')
  useEffect(() => {
    if (!data) return
    const json = JSON.stringify(data.platform)
    if (json === synced.current) return
    synced.current = json
    setDraft(structuredClone(data.platform))
  }, [data])

  if (loading && !data) return <Panel flush><ListLoading /></Panel>
  if (error || !data || !draft) return <Panel flush><Problem error={error ?? new BizError('Nothing came back.')} onRetry={() => void reload()} /></Panel>

  const saved = data.platform
  // Why something can't work live yet, from the API; nothing said means it's live.
  const live = data.live
  // Changes, as "group.switch", so each row can say it's been touched.
  const diff = new Set<string>()
  for (const [k, v] of Object.entries(draft)) {
    const was = (saved as unknown as Record<string, unknown>)[k]
    if (v && typeof v === 'object') {
      for (const [kk, vv] of Object.entries(v)) if ((was as Record<string, unknown>)[kk] !== vv) diff.add(`${k}.${kk}`)
    } else if (was !== v) diff.add(k)
  }
  const set = <G extends keyof Platform>(group: G, key: string, value: unknown) =>
    setDraft((d) => (d ? ({ ...d, [group]: typeof d[group] === 'object' ? { ...(d[group] as object), [key]: value } : value } as Platform) : d))
  const flip = (group: keyof Platform, key: string) => (v: boolean) => set(group, key, v)

  const TABS: readonly (readonly [Tab, string, string[]])[] = [["switches","Switches",["payouts","newBusinesses","maintenance","identity"]],["pay","Ways to pay",["methods","coins","networks","intents","intentCoins"]],["checkouts","Checkouts",["channels"]],["settle","Settlement",["destinations","settleChains"]],["fees","Fees",["fees"]],["limits","Limits & review",["limits","review","risk"]]]
  // Each tab counts the changes waiting to be saved in it.
  const waiting = (keys: string[]) => [...diff].filter((d) => keys.includes(d.split('.')[0]!)).length

  return (
    <div className="space-y-5 pb-24">
      {saved.maintenance && (
        <Notice tone="bad" title="Maintenance is on">
          Every checkout says payments are paused, no payment can start, and nothing can be sent from business wallets. Switch it off in Switches when you're done.
        </Notice>
      )}
      <Tabs value={tab} onChange={setTab} items={TABS.map(([id, label, keys]) => [id, label, waiting(keys)] as const)} />
      {tab === 'switches' && (
      <Group title="Kill switches" sub="For when something is wrong. They stop live payments only - test mode keeps working on the simulator. Payments already made are never lost either way.">
        <SwitchRow
          label="Maintenance"
          sub="On: every checkout (links, invoices, store QRs) says payments are paused and none can start, and nothing can be sent from business wallets. A transfer already on its way still lands."
          on={draft.maintenance}
          onChange={(v) => setDraft({ ...draft, maintenance: v })}
          changed={diff.has('maintenance')}
        />
        <SwitchRow
          label="Payouts"
          sub="Settlements go out the moment a payment confirms. Off: they wait in the queue, and go when it's back on."
          on={draft.payouts}
          onChange={(v) => setDraft({ ...draft, payouts: v })}
          changed={diff.has('payouts')}
        />
        <SwitchRow label="New businesses" sub="Off: nobody can open a new business. Existing ones carry on." on={draft.newBusinesses} onChange={(v) => setDraft({ ...draft, newBusinesses: v })} changed={diff.has('newBusinesses')} />
      </Group>
      )}

      {tab === 'switches' && (
      <Group title="Identity checks" sub="How the account representative proves who they are. Only new checks follow a change: ones under way finish the way they began, and approved ones stay approved. Businesses never see which is in use.">
        <SwitchRow
          label="Manual review"
          sub="On: they send a photo of their ID (the back too for a driver's licence), a selfie and a 3 second smile video, from their phone or computer, and you decide them in ID checks. Off: the automatic check by the identity partner."
          on={draft.identity?.manual ?? false}
          onChange={(v) => setDraft({ ...draft, identity: { ...draft.identity, manual: v } })}
          changed={diff.has('identity.manual')}
        />
        <SwitchRow label="Accepts NIN slip or card" sub="The front." on={draft.identity?.nin ?? true} onChange={(v) => setDraft({ ...draft, identity: { ...draft.identity, nin: v } })} changed={diff.has('identity.nin')} />
        <SwitchRow label="Accepts international passport" sub="The photo page." on={draft.identity?.passport ?? true} onChange={(v) => setDraft({ ...draft, identity: { ...draft.identity, passport: v } })} changed={diff.has('identity.passport')} />
        <SwitchRow label="Accepts driver's licence" sub="Front and back. At least one ID has to stay on." on={draft.identity?.licence ?? true} onChange={(v) => setDraft({ ...draft, identity: { ...draft.identity, licence: v } })} changed={diff.has('identity.licence')} />
      </Group>
      )}

      {tab === 'pay' && (
      <Group title="Ways to pay" sub="What customers can pay with at checkout. Switching one off stops it for live payments; test mode keeps them all.">
        <SwitchRow label="Bank transfer (naira)" sub="A one-time account for the exact amount." on={draft.methods.naira} onChange={flip('methods', 'naira')} changed={diff.has('methods.naira')} />
        <SwitchRow label="Money Moves app" on={draft.methods.app} onChange={flip('methods', 'app')} later={live?.methods.app} changed={diff.has('methods.app')} />
        <SwitchRow label="Crypto" on={draft.methods.crypto} onChange={flip('methods', 'crypto')} later={live?.methods.crypto} changed={diff.has('methods.crypto')} />
      </Group>
      )}

      {tab === 'checkouts' && (
      <Group title="Checkouts" sub="Off: nothing new of that kind can be made, and its live checkouts stop taking payments. Test mode carries on.">
        <SwitchRow label="Payment links" on={draft.channels.links} onChange={flip('channels', 'links')} changed={diff.has('channels.links')} />
        <SwitchRow label="Invoices" on={draft.channels.invoices} onChange={flip('channels', 'invoices')} changed={diff.has('channels.invoices')} />
        <SwitchRow label="Store QR (outlets)" on={draft.channels.outlets} onChange={flip('channels', 'outlets')} changed={diff.has('channels.outlets')} />
        <SwitchRow label="API checkouts" on={draft.channels.api} onChange={flip('channels', 'api')} changed={diff.has('channels.api')} />
      </Group>
      )}

      {tab === 'settle' && (
      <Group title="Settles to" sub="Where payments can be delivered. Off: live payments meant for it are held for the team to send on. Test mode carries on.">
        <SwitchRow label="Bank account" on={draft.destinations.bank} onChange={flip('destinations', 'bank')} changed={diff.has('destinations.bank')} />
        <SwitchRow label="Money Moves account" on={draft.destinations.moneyMoves} onChange={flip('destinations', 'moneyMoves')} later={live?.destinations.moneyMoves} changed={diff.has('destinations.moneyMoves')} />
        <SwitchRow label="Business wallet" on={draft.destinations.wallet} onChange={flip('destinations', 'wallet')} later={live?.destinations.wallet} changed={diff.has('destinations.wallet')} />
      </Group>
      )}

      {tab === 'settle' && (
      <Group title="Crypto settles on" sub="The chains a business can pick to receive USDC on. Switching one off hides it, and moves every business on it to Movement at once.">
        <SwitchRow
          label="Movement"
          sub="The default, where everyone falls back to. Off: payouts on Movement wait in the queue until it's back on, or until the team pays them by hand from Settlements."
          on={draft.settleChains.MOVEMENT}
          onChange={flip('settleChains', 'MOVEMENT')}
          later={live?.settleChains.MOVEMENT}
          changed={diff.has('settleChains.MOVEMENT')}
        />
        {(['ARC', 'MONAD', 'SOLANA', 'STELLAR'] as const).map((c) => (
          <SwitchRow key={c} label={c.charAt(0) + c.slice(1).toLowerCase()} on={draft.settleChains[c]} onChange={flip('settleChains', c)} later={live?.settleChains[c]} changed={diff.has(`settleChains.${c}`)} />
        ))}
      </Group>
      )}

      {tab === 'pay' && (
      <Group title="Customers can pay crypto with" sub="Coins, then the networks they can be sent on.">
        {(['USDC', 'USDT'] as const).map((c) => (
          <SwitchRow key={c} label={c} on={draft.coins[c]} onChange={flip('coins', c)} later={live?.coins[c]} changed={diff.has(`coins.${c}`)} />
        ))}
        {data.networks.map((n) => (
          <SwitchRow key={n} label={n} on={draft.networks[n] ?? true} onChange={flip('networks', n)} later={live?.networks[n]} changed={diff.has(`networks.${n}`)} />
        ))}
      </Group>
      )}

      {tab === 'pay' && (
      <Group title="Other coins, through NEAR Intents" sub="Customers pay in BTC, ETH, SOL and more. NEAR Intents swaps it to the exact USDC price, delivered to the payment's own address, and it settles to the business like any stablecoin payment. A swap that can't finish is refunded to our NEAR Intents account, and the team hands it back.">
        <SwitchRow
          label="Pay with another coin"
          sub={`Off: live checkouts show stablecoins only. Test mode always shows it. Lands as USDC on ${live?.intentLanding?.SOLANA ?? 'Solana'}, or on ${live?.intentLanding?.MONAD ?? 'Solana'} for businesses settling on Monad.`}
          on={draft.intents.on}
          onChange={flip('intents', 'on')}
          later={live?.intents}
          changed={diff.has('intents.on')}
        />
        <SwitchRow
          label="USDC and USDT through NEAR Intents too"
          sub={`Off is the default: stablecoins come straight to our own addresses. On: a USDC or USDT payment gets a NEAR Intents address instead, the customer sends about 1% more to cover it, and it lands and settles the same way. Only on ${(data.stableIntentPairs ?? []).map((p) => p.replace(':', ' on ')).join(', ') || 'the networks it takes'}. Anything else, or any payment it can't quote (BNB Chain needs $1,000 or more for now), goes the default way by itself. Works whether or not other coins are on.`}
          on={draft.intents.stablecoins ?? false}
          onChange={flip('intents', 'stablecoins')}
          later={live?.intents}
          changed={diff.has('intents.stablecoins')}
        />
        <NumberRow
          label="Swap fee"
          sub="Ours, taken inside the swap, on top of the usual crypto fee. 0 for none."
          unit="%"
          value={draft.intents.feeBps / 100}
          onChange={(v) => set('intents', 'feeBps', Math.max(0, Math.min(300, Math.round(v * 100))))}
          changed={diff.has('intents.feeBps')}
        />
        {(data.intentCoins ?? []).map((c) => (
          <SwitchRow key={c.key} label={`${c.symbol} on ${c.chain}`} sub={c.name} on={draft.intentCoins[c.key] ?? true} onChange={flip('intentCoins', c.key)} changed={diff.has(`intentCoins.${c.key}`)} />
        ))}
      </Group>
      )}

      {tab === 'fees' && (
      <Group title="Default fees" sub="What a business pays unless the team has set its own on the business page. Naira and stablecoin fees are set for each business there too. Applies to payments from the moment it's saved.">
        <NumberRow label="Naira payments" sub="Percent of what arrives" unit="%" value={draft.fees.nairaRateBps / 100} onChange={(v) => set('fees', 'nairaRateBps', Math.round(v * 100))} changed={diff.has('fees.nairaRateBps')} />
        <NumberRow label="Naira cap" sub="The most one naira payment pays" unit="₦" value={draft.fees.nairaCapNgn} onChange={(v) => set('fees', 'nairaCapNgn', v)} changed={diff.has('fees.nairaCapNgn')} />
        <NumberRow label="Crypto payments" sub="Percent of what arrives" unit="%" value={draft.fees.cryptoRateBps / 100} onChange={(v) => set('fees', 'cryptoRateBps', Math.round(v * 100))} changed={diff.has('fees.cryptoRateBps')} />
        <NumberRow label="Crypto cap" sub="The most one stablecoin payment pays" unit="$" value={draft.fees.cryptoCapUsd} onChange={(v) => set('fees', 'cryptoCapUsd', v)} changed={diff.has('fees.cryptoCapUsd')} />
        <NumberRow label="Money Moves app payments" unit="%" value={draft.fees.appRateBps / 100} onChange={(v) => set('fees', 'appRateBps', Math.round(v * 100))} changed={diff.has('fees.appRateBps')} />
        <NumberRow label="Bank payout from the wallet" sub="Per transfer" unit="₦" value={draft.fees.payoutNgn} onChange={(v) => set('fees', 'payoutNgn', v)} changed={diff.has('fees.payoutNgn')} />
      </Group>
      )}

      {tab === 'limits' && (
      <Group title="Checkout limits: bank transfer" sub="The least and the most one checkout paid by bank transfer can be, a fixed price or what the customer types. Each way to pay has its own: the checkout greys out a way the amount does not fit, and the amount box takes the widest. Dollar prices are checked at the rate of the moment. At most ₦20,000,000. Set a business’s own on its page.">
        <NumberRow label="Registered businesses: least" unit="₦" value={draft.limits.businessMinNgn} onChange={(v) => set('limits', 'businessMinNgn', v)} changed={diff.has('limits.businessMinNgn')} />
        <NumberRow label="Registered businesses: most" unit="₦" value={draft.limits.businessMaxNgn} onChange={(v) => set('limits', 'businessMaxNgn', v)} changed={diff.has('limits.businessMaxNgn')} />
        <NumberRow label="Freelancers (Just me): least" unit="₦" value={draft.limits.freelancerMinNgn} onChange={(v) => set('limits', 'freelancerMinNgn', v)} changed={diff.has('limits.freelancerMinNgn')} />
        <NumberRow label="Freelancers (Just me): most" unit="₦" value={draft.limits.freelancerMaxNgn} onChange={(v) => set('limits', 'freelancerMaxNgn', v)} changed={diff.has('limits.freelancerMaxNgn')} />
      </Group>
      )}

      {tab === 'limits' && (
      <Group title="Checkout limits: stablecoins" sub="One checkout paid with USDC or USDT.">
        <NumberRow label="Registered businesses: least" unit="₦" value={draft.limits.cryptoBusinessMinNgn} onChange={(v) => set('limits', 'cryptoBusinessMinNgn', v)} changed={diff.has('limits.cryptoBusinessMinNgn')} />
        <NumberRow label="Registered businesses: most" unit="₦" value={draft.limits.cryptoBusinessMaxNgn} onChange={(v) => set('limits', 'cryptoBusinessMaxNgn', v)} changed={diff.has('limits.cryptoBusinessMaxNgn')} />
        <NumberRow label="Freelancers (Just me): least" unit="₦" value={draft.limits.cryptoFreelancerMinNgn} onChange={(v) => set('limits', 'cryptoFreelancerMinNgn', v)} changed={diff.has('limits.cryptoFreelancerMinNgn')} />
        <NumberRow label="Freelancers (Just me): most" unit="₦" value={draft.limits.cryptoFreelancerMaxNgn} onChange={(v) => set('limits', 'cryptoFreelancerMaxNgn', v)} changed={diff.has('limits.cryptoFreelancerMaxNgn')} />
      </Group>
      )}

      {tab === 'limits' && (
      <Group title="Checkout limits: Money Moves app" sub="One checkout paid from the Money Moves app, on a checkout page or by scanning in the app.">
        <NumberRow label="Registered businesses: least" unit="₦" value={draft.limits.appBusinessMinNgn} onChange={(v) => set('limits', 'appBusinessMinNgn', v)} changed={diff.has('limits.appBusinessMinNgn')} />
        <NumberRow label="Registered businesses: most" unit="₦" value={draft.limits.appBusinessMaxNgn} onChange={(v) => set('limits', 'appBusinessMaxNgn', v)} changed={diff.has('limits.appBusinessMaxNgn')} />
        <NumberRow label="Freelancers (Just me): least" unit="₦" value={draft.limits.appFreelancerMinNgn} onChange={(v) => set('limits', 'appFreelancerMinNgn', v)} changed={diff.has('limits.appFreelancerMinNgn')} />
        <NumberRow label="Freelancers (Just me): most" unit="₦" value={draft.limits.appFreelancerMaxNgn} onChange={(v) => set('limits', 'appFreelancerMaxNgn', v)} changed={diff.has('limits.appFreelancerMaxNgn')} />
      </Group>
      )}

      {tab === 'limits' && (
      <Group
        title="Payouts a person checks"
        sub="Live payouts bigger than these wait in Settlements → To review until someone approves them or pays them by hand. Businesses are never told: they see the payout as on its way. Set a business’s own on its page."
      >
        <NumberRow
          label="Naira above"
          sub="Settlements to a bank account"
          unit="₦"
          value={draft.review.nairaAboveNgn}
          onChange={(v) => set('review', 'nairaAboveNgn', v)}
          changed={diff.has('review.nairaAboveNgn')}
        />
        <NumberRow
          label="Crypto above"
          sub="Settlements to a business wallet or a Money Moves account"
          unit="$"
          value={draft.review.cryptoAboveUsd}
          onChange={(v) => set('review', 'cryptoAboveUsd', v)}
          changed={diff.has('review.cryptoAboveUsd')}
        />
      </Group>
      )}

      {tab === 'limits' && (
      <Group
        title="Daily limits"
        sub="A safety net against fraud. Once a business has received more than its daily limit in live payments today, it can still take payments, but its payouts wait in Settlements → To review until someone approves them. Businesses are never told. A business's own limit is set on its page."
      >
        <NumberRow label="A business counts as new for" sub="Days after it signs up" unit="days" value={draft.risk.newDays} onChange={(v) => set('risk', 'newDays', v)} changed={diff.has('risk.newDays')} />
        <NumberRow label="Daily limit while new" sub="Received in one day, before payouts wait" unit="₦" value={draft.risk.newDailyNgn} onChange={(v) => set('risk', 'newDailyNgn', v)} changed={diff.has('risk.newDailyNgn')} />
        <NumberRow label="Daily limit after that" sub="For every business past its first days" unit="₦" value={draft.risk.dailyNgn} onChange={(v) => set('risk', 'dailyNgn', v)} changed={diff.has('risk.dailyNgn')} />
      </Group>
      )}

      {tab === 'limits' && (
      <Group
        title="Unusual activity"
        sub="Flags a business on the Overview when today is far above its normal day. Only a flag for you to look at: nothing is held."
      >
        <NumberRow label="Flag when today is more than" sub="Times its average day over the last 30 days" unit="×" value={draft.risk.spikeTimes} onChange={(v) => set('risk', 'spikeTimes', v)} changed={diff.has('risk.spikeTimes')} />
        <NumberRow label="And today is at least" sub="So small amounts, like a quiet business's first sale, aren't flagged" unit="₦" value={draft.risk.spikeMinNgn} onChange={(v) => set('risk', 'spikeMinNgn', v)} changed={diff.has('risk.spikeMinNgn')} />
      </Group>
      )}

      {data.updatedBy && data.updatedAt && (
        <p className="px-1 text-[12px]" style={{ color: C.dim }}>
          Last changed by {data.updatedBy}, {ago(data.updatedAt)}.
        </p>
      )}

      {/* The save bar: only there when something has changed. */}
      {(diff.size > 0 || said) && (
        <div className="fixed inset-x-0 bottom-0 z-40 lg:left-[216px]" style={{ background: C.bg, borderTop: `1px solid ${C.line}` }}>
          <div className="mx-auto max-w-[1024px] px-4 py-3 sm:px-6">
            {diff.size > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-auto text-[13px] font-medium" style={{ color: C.amber }}>
                  {diff.size} unsaved change{diff.size === 1 ? '' : 's'}
                </span>
                <PasswordInput value={password} onChange={setPassword} />
                <Button onClick={() => setDraft(structuredClone(saved))} disabled={busy}>
                  Undo
                </Button>
                <Button tone="primary" disabled={busy || !password} onClick={() => void run(() => biz('/platform', { method: 'PUT', body: { platform: draft, password } }), 'Saved. Every business has it within seconds.')}>
                  {busy ? 'Saving…' : 'Save'}
                </Button>
              </div>
            )}
            {said && <Said {...said} />}
          </div>
        </div>
      )}
    </div>
  )
}
