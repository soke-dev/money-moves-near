import { prisma } from "./prisma";

/**
 * The flat charge on a Solana send, when the switch below is on.
 *
 * In the asset being sent, so a USDC transfer is charged in USDC and a USDT
 * one in USDT - taking it in the other would need a token account the sender
 * may not have, and opening one costs more than the fee.
 */
export const SOLANA_SEND_FEE = 0.05;

/** Whether Solana sends are being charged right now. */
export async function solanaSendFee(): Promise<number> {
  return (await getEffectiveChoice("solanaSendFee")) === "on" ? SOLANA_SEND_FEE : 0;
}
import { env } from "../config/env";
import { isFlutterwaveConfigured } from "./flutterwave";
import { isPaystackConfigured } from "./paystack";
import { isFlwBillsConfigured } from "./flw-bills";

/**
 * Turning a service off, without a deploy.
 *
 * Pausing used to mean setting an environment variable on Railway, which
 * restarts the backend. That is exactly backwards: the moment you most need
 * the switch — a payout partner is down, a provider is returning nonsense — is
 * the moment you least want to restart anything. So the state lives in a row,
 * the console writes it, and this reads it.
 *
 * Two things stay unchanged on purpose. The 503 guards in the routes are still
 * the only thing that actually stops money moving; everything the app does
 * with this is courtesy, shown earlier so nobody walks three screens in to
 * find out. And the env flags still win, so there is a way out when the
 * database is the thing that is broken.
 */

export type ServiceKey =
  | "solanaSendFee"
  | "bank"
  | "funding"
  | "airtime"
  | "data"
  | "electricity"
  | "username"
  | "withdraw"
  | "cable"
  | "betting"
  | "signups"
  | "sweep"
  | "emails"
  | "payout"
  | "bills"
  | "dataProvider";

type Service = {
  key: ServiceKey;
  label: string;
  /** What it blocks, named the way the console names it. */
  blocks: string;
  /** The break-glass flag, read fresh each time. */
  override: () => boolean;
  /**
   * A service somebody can tap, or a plain switch.
   *
   * The three want different words. "Pause" and "Resume" are right for a thing
   * with a row in the app that stops being tappable; for whether we send
   * receipts they are borrowed clothes, and the console says on and off; and a
   * choice between two payout rails is neither, so it gets a picker.
   */
  kind?: "service" | "switch" | "choice";
  /**
   * For a choice: what it may be set to. First is the default.
   *
   * `ready` is whether that option could actually do the job right now -
   * a payout rail with no API key is a choice you must not be able to make,
   * because making it would stop payouts rather than move them.
   */
  options?: readonly { id: string; label: string; ready: () => boolean }[];
  /** For a choice: an environment variable that overrides what is stored. */
  envValue?: () => string | undefined;
  /**
   * What this switch is, and what throwing it costs.
   *
   * Written beside the switch rather than in the console, because a generic
   * renderer with copy of its own says the same sentence under every switch -
   * which is how the bills picker came to tell people about bank payouts.
   */
  blurb?: string;
  caveat?: string;
  /**
   * Whether the app is told about it. Default true.
   *
   * /status is public and exists so the app can mark a row before anyone taps
   * it. A switch with no row in the app has nothing to mark, so publishing it
   * would only be telling the world something it cannot use.
   */
  app?: boolean;
};

/**
 * What a paused service says when nobody wrote anything.
 *
 * One sentence for all six, and deliberately silent about which service it
 * is: the app titles the sheet with the service name, so a default that named
 * it too would print the same thing twice. It is the same wording as
 * PAUSED_FALLBACK in the app, so both routes into the sheet read alike.
 *
 * The word "maintenance" is in here on purpose. Builds already on people's
 * phones raise their modal by matching that word in the error, and a default
 * that quietly stopped matching would drop them to a plain alert. A message
 * written in the console is free of that constraint.
 */
export const DEFAULT_PAUSE_MESSAGE =
  "We are doing a bit of maintenance here. Please try again shortly.";

/**
 * The default for the sign-up switch, which needs its own.
 *
 * "Maintenance, try again shortly" is wrong twice over for somebody who
 * already has an account and just typed their email: sign-in is not paused
 * for them, and waiting will not help if they meant to make a second one. It
 * says who is affected and who is not. A message written in the console
 * still wins.
 */
export const SIGNUPS_PAUSED_MESSAGE =
  "New sign-ups are paused for now. If you already have an account, you can still sign in with its email.";

/** The message a paused sign-up is refused with: the console's words, else ours. */
export async function signupsPausedMessage(): Promise<string | null> {
  const msg = await pauseGuard("signups");
  if (!msg) return null;
  return msg === DEFAULT_PAUSE_MESSAGE ? SIGNUPS_PAUSED_MESSAGE : msg;
}

/**
 * Every service the console can turn off.
 *
 * `username` and `withdraw` have no environment flag behind them — they never
 * had one — so their only switch is the row. The per-token funding flags
 * (USDT, SOL, USDC on Base, USDC on Solana) stay environment-only: they are
 * reached for rarely and one row each would bury the six that matter.
 */
export const SERVICES: readonly Service[] = [
  {
    key: "bank",
    label: "Bank transfers",
    blocks: "quote · prepare · submit",
    override: () => env.BANK_TRANSFER_MAINTENANCE,
  },
  {
    key: "funding",
    label: "Crypto purchases",
    blocks: "buy",
    override: () => env.FUNDING_MAINTENANCE,
  },
  /**
   * Separate switches, because they fail separately.
   *
   * They were one because they are one provider call. But a provider can vend
   * airtime perfectly and not vend data at all - which is exactly what
   * Flutterwave does on this account - and one switch then forces a choice
   * between turning off something that works and leaving on something that
   * does not.
   *
   * AIRTIME_MAINTENANCE still forces both, so the old break-glass keeps
   * meaning what it meant.
   */
  {
    key: "airtime",
    label: "Airtime",
    blocks: "airtime top-ups",
    override: () => env.AIRTIME_MAINTENANCE,
  },
  {
    key: "data",
    label: "Data",
    blocks: "data bundles",
    override: () => env.AIRTIME_MAINTENANCE,
  },
  {
    key: "electricity",
    label: "Electricity",
    blocks: "electricity",
    override: () => env.ELECTRICITY_MAINTENANCE,
  },
  {
    key: "username",
    label: "Username transfers",
    blocks: "send to username",
    override: () => false,
  },
  {
    key: "withdraw",
    label: "Crypto withdrawals",
    blocks: "withdraw",
    override: () => false,
  },
  {
    key: "cable",
    label: "Cable TV",
    blocks: "dstv · gotv · startimes",
    override: () => false,
  },
  {
    key: "betting",
    label: "Betting",
    blocks: "fund a betting account",
    override: () => false,
  },
  /**
   * New accounts, and only new accounts.
   *
   * Pausing this refuses the step that creates an account - /auth/dynamic for
   * an email we have never seen, and the old password /register - and nothing
   * else. Everybody who already has an account signs in exactly as before,
   * because an emergency brake that also locked out existing customers would
   * be a second emergency.
   */
  {
    key: "signups",
    label: "New sign-ups",
    blocks: "creating a new account",
    override: () => false,
  },
  /**
   * Sweep, for when the Movement treasury that pays it out cannot.
   *
   * A sweep takes the person's coins first and pays USDC on Movement second,
   * so a treasury out of USDC or out of MOVE for gas leaves legs held. Paused,
   * the Sweep tag leaves Home and new sweeps are refused; a sweep already
   * signed still finishes, since stopping it halfway would strand coins.
   * Swap has its own switch in the Swap tab.
   */
  {
    key: "sweep",
    label: "Sweep",
    blocks: "gathering small balances",
    override: () => false,
    app: false,
  },
  /**
   * Receipts, and only receipts.
   *
   * The eight emails behind sendTransactionalEmail - the ones that say money
   * arrived or left. Sign-in codes, password resets, PIN resets and wallet
   * export codes call sendEmail directly and are untouched by this, which is
   * the whole reason it is safe to have a button for it: turning receipts off
   * cannot lock anybody out of their own account.
   *
   * The environment flag reads the other way round - it says enabled where
   * every other one says paused - so it is inverted here rather than anywhere
   * a reader would have to remember it.
   */
  /**
   * A flat charge on Solana sends, off unless somebody turns it on.
   *
   * Solana is the chain where a transfer costs us something per send and
   * where opening a recipient's token account costs us rather more - which
   * is what got farmed in September. The daily cap answers that and stays
   * whatever this says; this is the other half, so that volume which is not
   * spam contributes something towards the volume that is.
   *
   * Only sends: to another wallet, or to a username. Selling and paying a
   * bill are how people get value out of the app and already carry their own
   * fees, so they are untouched.
   *
   * A choice rather than a switch, because a switch stores its state in
   * `paused` where false is the default - and false would have to mean "fee
   * on" for the default to be off. Off as the first option says the same
   * thing without anybody having to hold an inversion in their head.
   */
  {
    key: "solanaSendFee",
    label: "Solana send fee",
    blocks: "nothing",
    override: () => false,
    kind: "choice",
    options: [
      { id: "off", label: "Off", ready: () => true },
      { id: "on", label: `On (${SOLANA_SEND_FEE} per send)`, ready: () => true },
    ],
    blurb:
      `A flat ${SOLANA_SEND_FEE} USDC or USDT on Solana sends to a wallet or a username, taken in whichever of the two is being sent and paid into the Solana sell wallet. Selling and bills are not charged. We still pay the network fee either way; this is so that ordinary volume offsets a little of what spam costs us.`,
    caveat:
      "Takes effect on the next send. The daily Solana cap is separate and stays where it is whether this is on or off.",
    app: false,
  },
  {
    key: "emails",
    label: "Transaction emails",
    blocks: "receipts",
    override: () => !env.ENABLE_TRANSACTIONAL_EMAILS,
    kind: "switch",
    app: false,
  },
  /**
   * Which rail sell payouts go out on.
   *
   * Not a pause and not a toggle - `paused` means nothing here, `value` is the
   * whole point. It lives in this table because this is where the things an
   * administrator flips already live, with one cache, one audit trail and one
   * page, and because a second table for one row would be a table nobody
   * remembers exists.
   *
   * See lib/payout.ts for the rule that makes flipping it safe: the provider
   * is stamped on the transaction when the payout is created, and every later
   * read uses the stamp rather than this.
   */
  {
    key: "payout",
    label: "Payout provider",
    blocks: "bank payouts · account resolution",
    override: () => false,
    kind: "choice",
    options: [
      { id: "flutterwave", label: "Flutterwave", ready: isFlutterwaveConfigured },
      { id: "paystack", label: "Paystack", ready: isPaystackConfigured },
    ],
    envValue: () => env.PAYOUT_PROVIDER,
    blurb:
      "Which rail bank payouts leave on, and which one checks an account name when somebody adds a bank. Funding is not affected — naira coming in always arrives on Flutterwave.",
    caveat:
      "Takes effect on the next payout. Anything already sent finishes on the rail that sent it, so switching mid-flight cannot pay somebody twice.",
    app: false,
  },
  /**
   * Which provider sells airtime, data and electricity.
   *
   * Flutterwave first, so it is the default - but only while it can actually
   * sell: with no v3 secret key `ready` is false, the console will not let it
   * be picked, and the choice resolves to vtu.ng rather than quietly stopping
   * every bill in the app.
   *
   * See lib/bills-provider.ts for why flipping this is safe mid-flight: the
   * provider is stamped on the transaction at prepare, and the two do not even
   * sell the same data plans.
   */
  {
    key: "bills",
    label: "Bills provider",
    blocks: "airtime · data · electricity",
    override: () => false,
    kind: "choice",
    options: [
      { id: "flutterwave", label: "Flutterwave", ready: isFlwBillsConfigured },
      { id: "vtu", label: "VTU.ng", ready: () => true },
    ],
    blurb:
      "Who sells airtime and electricity. Data has its own switch below, because a rail can vend one and not the other.",
    caveat:
      "Takes effect on the next purchase. A bill already prepared is bought from the provider it was prepared on, and every purchase asks that provider whether it has seen the reference before it sends anything.",
    app: false,
  },
  /**
   * Data, separately.
   *
   * The two providers do not stock the same bundles at the same prices, and
   * more to the point they do not both work: Flutterwave vends airtime on this
   * account and cannot vend data at all - it passes amount validation and
   * fails at the vend, from their own dashboard as well as from here. So this
   * defaults to vtu.ng and Flutterwave stays selectable, for the day that
   * changes and somebody wants to try it.
   */
  {
    key: "dataProvider",
    label: "Data provider",
    blocks: "data bundles",
    override: () => false,
    kind: "choice",
    options: [
      { id: "vtu", label: "VTU.ng", ready: () => true },
      { id: "flutterwave", label: "Flutterwave", ready: isFlwBillsConfigured },
    ],
    blurb:
      "Who sells data bundles. Kept apart from the switch above because a rail can vend airtime perfectly and not vend data at all — which is what Flutterwave does on this account today, so picking it here will fail until they fix it.",
    caveat:
      "Takes effect on the next purchase. The plan list somebody picks from comes from whichever is live here, and a plan chosen under one provider can only be bought from that provider.",
    app: false,
  },
] as const;

const byKey = new Map(SERVICES.map((s) => [s.key, s]));

export type ServiceState = {
  key: ServiceKey;
  label: string;
  blocks: string;
  kind: "service" | "switch" | "choice";
  options: readonly { id: string; label: string; ready: boolean }[] | null;
  blurb: string | null;
  caveat: string | null;
  /** What will actually be used. */
  value: string | null;
  /** What is stored, which differs from `value` only when something overrode it. */
  chosen: string | null;
  /** True when an environment variable is driving the choice. */
  pinned: boolean;
  paused: boolean;
  /** True when an environment flag is forcing it, not the row. */
  forced: boolean;
  note: string | null;
  message: string | null;
  backBy: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

type Row = {
  key: string;
  paused: boolean;
  value: string | null;
  note: string | null;
  message: string | null;
  backBy: Date | null;
  updatedBy: string | null;
  updatedAt: Date;
};

// ─── The cache ────────────────────────────────────────────────
//
// Thirty seconds. Every guarded request would otherwise cost a query to
// discover that nothing is paused, which is the answer almost every time.
//
// It is per-process, so with more than one instance running a flip reaches
// them within a window rather than at an instant. That is the right trade for
// a pause: half a minute of one instance still serving is not a correctness
// problem, and the guards are per-request either way.
const TTL_MS = 30_000;
let cache: Map<string, Row> | null = null;
let readAt = 0;

async function rows(): Promise<Map<string, Row>> {
  if (cache && Date.now() - readAt < TTL_MS) return cache;

  try {
    const found = await prisma.serviceStatus.findMany();
    cache = new Map(found.map((r) => [r.key, r as Row]));
    readAt = Date.now();
  } catch (err) {
    /**
     * Unreadable means live.
     *
     * The alternative — treating a failed read as "everything is paused" —
     * would turn a blip in one table into a full outage, and it would do it
     * at the exact moment the rest of the request was going to fail on its
     * own anyway. The env flags are the deliberate way to shut things off
     * when the database cannot be trusted.
     *
     * The clock is still stamped so a broken table is asked about twice a
     * minute rather than on every request.
     */
    console.error("[SERVICES] could not read service_status:", err);
    cache = cache ?? new Map();
    readAt = Date.now();
  }

  return cache;
}

/** Drop the cache, so a write the console just made is visible at once. */
export function invalidateServiceCache() {
  cache = null;
  readAt = 0;
}

/**
 * The message to refuse with, or null when the service is live.
 *
 * Returning the sentence rather than a boolean keeps the guard in each route
 * to two lines, and means what somebody reads is what was typed in the
 * console rather than a string frozen into the route file.
 */
export async function pauseGuard(key: ServiceKey): Promise<string | null> {
  const svc = byKey.get(key);
  if (!svc) return null;

  if (svc.override()) return DEFAULT_PAUSE_MESSAGE;

  const row = (await rows()).get(key);
  if (!row?.paused) return null;

  return row.message?.trim() || DEFAULT_PAUSE_MESSAGE;
}

export async function isPaused(key: ServiceKey): Promise<boolean> {
  return (await pauseGuard(key)) !== null;
}

/** Everything, for the console and for the app's own status call. */
export async function listServices(): Promise<ServiceState[]> {
  const found = await rows();

  return SERVICES.map((svc) => {
    const row = found.get(svc.key);
    const forced = svc.override();

    return {
      key: svc.key,
      label: svc.label,
      blocks: svc.blocks,
      kind: svc.kind ?? "service",
      options: svc.options?.map((o) => ({ id: o.id, label: o.label, ready: o.ready() })) ?? null,
      blurb: svc.blurb ?? null,
      caveat: svc.caveat ?? null,
      value: svc.kind === "choice" ? resolveChoice(svc, row?.value ?? null) : null,
      chosen: row?.value ?? null,
      pinned: svc.kind === "choice" && !!validEnvValue(svc),
      paused: forced || !!row?.paused,
      forced,
      note: row?.note?.trim() || null,
      message: row?.message?.trim() || null,
      backBy: row?.backBy ? row.backBy.toISOString() : null,
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    };
  });
}

/** The environment's answer, if it named one this service actually offers. */
function validEnvValue(svc: Service): string | undefined {
  const forced = svc.envValue?.()?.trim().toLowerCase();
  if (!forced) return undefined;
  return svc.options?.some((o) => o.id === forced && o.ready()) ? forced : undefined;
}

/**
 * What a choice will actually be used as, which is not always what is stored.
 *
 * Three things can differ from the row, in order: an environment variable
 * pinning it, a stored answer naming something no longer on offer, and a
 * stored answer naming an option that cannot currently do the job. The last is
 * the one that matters - choosing a payout rail whose API key has been removed
 * must not stop payouts, it must fall through to the rail that can still pay.
 *
 * Reported rather than hidden, so the console shows what is true instead of
 * what was typed.
 */
function resolveChoice(svc: Service, stored: string | null): string | null {
  const forced = validEnvValue(svc);
  if (forced) return forced;

  const want = stored?.trim().toLowerCase();
  if (want && svc.options?.some((o) => o.id === want && o.ready())) return want;

  return svc.options?.find((o) => o.ready())?.id ?? svc.options?.[0]?.id ?? null;
}

/**
 * The option a choice resolves to, for the code that acts on it.
 *
 * One implementation, so what the console shows and what the payout path does
 * can never drift apart.
 */
export async function getEffectiveChoice(key: ServiceKey): Promise<string | null> {
  const svc = byKey.get(key);
  if (!svc || svc.kind !== "choice") return null;
  return resolveChoice(svc, (await rows()).get(key)?.value ?? null);
}

/**
 * What a choice is currently set to.
 *
 * Read through the same cache as everything else, so asking it on every payout
 * costs nothing. Null when nobody has chosen; the caller decides what that
 * means rather than having a default invented for it here.
 */
export async function getSwitchValue(key: ServiceKey): Promise<string | null> {
  const row = (await rows()).get(key);
  return row?.value ?? null;
}

export async function setService(
  key: ServiceKey,
  patch: {
    paused?: boolean;
    note?: string | null;
    message?: string | null;
    backBy?: Date | null;
    value?: string | null;
  },
  adminEmail: string,
): Promise<ServiceState[]> {
  const data = {
    ...(patch.paused !== undefined ? { paused: patch.paused } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.message !== undefined ? { message: patch.message } : {}),
    ...(patch.backBy !== undefined ? { backBy: patch.backBy } : {}),
    ...(patch.value !== undefined ? { value: patch.value } : {}),
    updatedBy: adminEmail,
  };

  await prisma.serviceStatus.upsert({
    where: { key },
    create: { key, paused: false, ...data },
    update: data,
  });

  invalidateServiceCache();
  console.log(
    patch.value !== undefined
      ? `[SERVICES] ${key} set to ${patch.value} by ${adminEmail}`
      : `[SERVICES] ${key} ${patch.paused === undefined ? "edited" : patch.paused ? "paused" : "resumed"} by ${adminEmail}`,
  );

  return listServices();
}

/** The keys /status publishes. */
export function isAppFacing(key: ServiceKey): boolean {
  return byKey.get(key)?.app !== false;
}

export function isServiceKey(v: unknown): v is ServiceKey {
  return typeof v === "string" && byKey.has(v as ServiceKey);
}
