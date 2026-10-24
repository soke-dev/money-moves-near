import { prisma } from "./prisma";
import {
  SY_CHAIN,
  createAccount,
  getAccountByExternalId,
  linkMovementWallet,
  listSettlementDestinations,
  setSettlementProfile,
  createDepositAddresses,
  listDepositAddresses,
  listDeposits,
} from "./stableyard";

/**
 * Getting a person ready to receive routed deposits, on demand.
 *
 * The setup script did this for one account by hand. This is the same sequence
 * for anybody, run the first time they open a routed deposit screen, so nobody
 * has to be enrolled in advance.
 *
 * Every step is idempotent or checked first, because none of it is safe to do
 * twice: a second UPA splits a person's history, and a second deposit address
 * is money pointed somewhere nobody is watching. The creates carry keys
 * derived from our own ids; the wallet link, which takes no key, is guarded by
 * reading the settlement destinations first.
 *
 * Addresses are not cached in our database, but a deposit address never
 * changes, so the resolved set is held in process for a few minutes to keep a
 * screen somebody opens twice from asking twice.
 *
 * The one thing we DO write down is that a person has an account at all, keyed
 * by our user id. The provider has no endpoint that lists accounts, so without
 * that note the only way to find out who is enrolled is to ask about every
 * user one at a time - and asking creates the account, which is how a
 * read-only admin screen could enrol sixty people who never asked for it.
 */

/** Kept as service_status rows, the same as the visibility switches. */
const ACCT_KEY = (userId: string) => `syacct:${userId}`;

async function rememberAccount(userId: string, accountId: string): Promise<void> {
  await prisma.serviceStatus
    .upsert({
      where: { key: ACCT_KEY(userId) },
      create: { key: ACCT_KEY(userId), value: accountId },
      update: { value: accountId },
    })
    .catch(() => {});
}

/** Everyone we know has an account, without asking the provider anything. */
export async function enrolledAccounts(): Promise<{ userId: string; accountId: string }[]> {
  const rows = await prisma.serviceStatus.findMany({
    where: { key: { startsWith: "syacct:" } },
    select: { key: true, value: true },
  });
  return rows
    .filter((r) => !!r.value)
    .map((r) => ({ userId: r.key.slice("syacct:".length), accountId: r.value! }));
}

export type RoutedAddress = {
  chainId: number;
  address: string;
  assets: { symbol: string; minimum: string | null; decimals: number | null }[];
};

async function ensureAccount(userId: string): Promise<string | null> {
  const existing = await getAccountByExternalId(userId);
  const found = existing.data?.account?.id;
  if (found) {
    await rememberAccount(userId, found);
    return found;
  }

  const made = await createAccount(userId);
  const id = made.data?.account?.id ?? null;
  if (id) await rememberAccount(userId, id);
  return id;
}

/**
 * The same look-up, guaranteed not to create anything.
 *
 * For callers that are reporting on people rather than serving them - an admin
 * listing every deposit should never be the reason somebody gets registered at
 * a payment provider.
 */
async function accountIdOnly(userId: string): Promise<string | null> {
  const existing = await getAccountByExternalId(userId).catch(() => null);
  const found = existing?.data?.account?.id ?? null;
  if (found) await rememberAccount(userId, found);
  return found;
}

async function ensureSettlement(accountId: string, movementAddress: string): Promise<boolean> {
  const findMovement = async () => {
    const d = await listSettlementDestinations(accountId);
    const list: any[] = d.data?.destinations ?? [];
    return list.find((x) => Number(x.capabilities?.network?.chainId) === SY_CHAIN.MOVEMENT) ?? null;
  };

  let dest = await findMovement();
  if (!dest) {
    // Address and chainId only — their own example's extra fields return a 500.
    const linked = await linkMovementWallet(accountId, movementAddress);
    if (!linked.ok) return false;
    dest = await findMovement();
  }
  if (!dest?.id) return false;

  const profile = await setSettlementProfile(accountId, dest.id);
  return profile.ok;
}

/**
 * Addresses this person can be given, for the chains asked for.
 *
 * Ordered for the case that actually happens. Once somebody has their
 * addresses, nothing needs creating or configuring ever again - so the steady
 * path is two calls, look up the account and list the addresses, and the
 * enrolment work only runs when an address is genuinely missing.
 *
 * It used to do all five every time, including rewriting the settlement
 * profile on each screen open, which made opening Add money take seconds.
 */
export async function ensureRoutedAddresses(
  userId: string,
  chainIds: number[],
): Promise<{ ok: boolean; accountId?: string; addresses: RoutedAddress[]; error?: string }> {
  if (!chainIds.length) return { ok: true, addresses: [] };

  const cached = fromCache(userId, chainIds);
  if (cached) return { ok: true, addresses: cached };

  const accountId = await ensureAccount(userId);
  if (!accountId) return { ok: false, addresses: [], error: "Could not open a deposit account." };

  let rows = await readAddresses(accountId);
  let missing = chainIds.filter((c) => !rows.some((r) => r.chainId === c));

  if (missing.length) {
    /**
     * Only now is the settlement destination worth checking.
     *
     * An address that already exists was created against a profile, and that
     * snapshot is taken per deposit anyway - so re-asserting it on a screen
     * open achieves nothing except latency.
     */
    const wallet = await prisma.wallet.findFirst({
      where: { userId, chain: "MOVE", address: { not: null } },
      select: { address: true },
    });
    if (!wallet?.address) {
      return { ok: false, accountId, addresses: [], error: "No Movement wallet on this account yet." };
    }

    const settled = await ensureSettlement(accountId, wallet.address);
    if (!settled) {
      return { ok: false, accountId, addresses: [], error: "Could not set the settlement wallet." };
    }

    /**
     * One chain per request, so one refused network cannot cost the others.
     *
     * This asked for every missing chain in a single call, and Stableyard
     * answers a batch as a unit: when it began refusing new reusable
     * addresses on one network ("temporarily unavailable on this network",
     * a 503), the whole request failed and a new user was handed nothing at
     * all - not even the chains that would have worked. Only accounts
     * enrolled before that started still had addresses, because the steady
     * path reads them and never creates.
     *
     * The idempotency key is per chain as a result, which also keeps a
     * refusal cached against an old multi-chain key from being replayed.
     */
    const refused: number[] = [];
    for (const chainId of missing) {
      const made = await createDepositAddresses(accountId, [chainId]);
      if (!made.ok) {
        refused.push(chainId);
        console.warn(
          `[ROUTED] chain ${chainId} refused for ${accountId}: ${made.status} ${made.error ?? ""}`.trim(),
        );
      }
    }
    rows = await readAddresses(accountId);

    // Nothing at all is a real failure. Some is a partial answer, and a
    // partial answer beats telling somebody deposits are down.
    if (!rows.some((r) => chainIds.includes(r.chainId))) {
      return { ok: false, accountId, addresses: [], error: "Could not create a deposit address." };
    }
    if (refused.length) {
      const addresses = rows.filter((r) => chainIds.includes(r.chainId));
      // Not cached: the refused chains should be retried on the next open,
      // not held back for five minutes after the provider recovers.
      return { ok: true, accountId, addresses };
    }
  }

  const addresses = rows.filter((r) => chainIds.includes(r.chainId));
  putCache(userId, addresses);
  return { ok: true, accountId, addresses };
}

async function readAddresses(accountId: string): Promise<RoutedAddress[]> {
  const r = await listDepositAddresses(accountId);
  const list: any[] = r.data?.depositAddresses ?? [];
  return list.map((x) => ({
    chainId: Number(x.chainId),
    address: String(x.address),
    assets: (x.supportedAssets ?? []).map((a: any) => ({
      symbol: String(a.symbol),
      // Straight from the server. It has contradicted the docs twice.
      minimum: a.minimumDeposit?.amount ?? null,
      decimals: a.decimals ?? null,
    })),
  }));
}

/**
 * A short memory, because a deposit address never changes.
 *
 * In process rather than in the database: there is no table for this yet, and
 * the only thing being saved is a round trip on a screen somebody opens twice
 * in a minute. Five minutes is long enough to cover that and short enough that
 * a newly enabled chain appears without a restart.
 */
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; addresses: RoutedAddress[] }>();

function fromCache(userId: string, chainIds: number[]): RoutedAddress[] | null {
  const hit = cache.get(userId);
  if (!hit || Date.now() - hit.at > CACHE_MS) return null;
  // Only usable if it covers everything being asked for.
  const covered = chainIds.every((c) => hit.addresses.some((a) => a.chainId === c));
  return covered ? hit.addresses.filter((a) => chainIds.includes(a.chainId)) : null;
}

function putCache(userId: string, addresses: RoutedAddress[]) {
  cache.set(userId, { at: Date.now(), addresses });
}

/**
 * Where a routed deposit has got to, said in five words instead of theirs.
 *
 * Their vocabulary has more states than a person needs - detected, confirming,
 * settling, settled, failed, requires_intervention - and two of them mean the
 * same thing to somebody watching a screen. These are the ones worth drawing.
 *
 * `review` is deliberately not called failed. Their console labels it that
 * way and it is the one word that must not appear: the money has arrived and
 * is being looked at by a person, and telling somebody it failed invites them
 * to write it off.
 */
export type RoutedStatus =
  | "detected"
  | "converting"
  | "settled"
  | "failed"
  | "review"
  /** Seen at our address and deliberately not processed by the provider. */
  | "ignored";

export type RoutedDepositActivity = {
  id: string;
  chainId: number;
  status: RoutedStatus;
  sentAmount: string | null;
  sentSymbol: string | null;
  receivedAmount: string | null;
  receivedSymbol: string | null;
  sourceTxHash: string | null;
  settlementTxHash: string | null;
  /** Taken out of the settlement, in the settlement asset. Known up front. */
  feeAmount: string | null;
  feeSymbol: string | null;
  /** What the conversion produced, before their fee came out of it. */
  receivedBeforeFee: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

function mapStatus(raw: string): RoutedStatus {
  switch (raw) {
    case "settled":
      return "settled";
    case "failed":
      return "failed";
    case "requires_intervention":
      return "review";
    /**
     * Their word for "this is not a deposit".
     *
     * Dust, gas top-ups and anything under the floor land at our address
     * like everything else and are then set aside. Falling through to
     * detected left one of those sitting at Processing forever, on a
     * screen whose job is to say what is happening to somebody's money.
     */
    case "ignored":
      return "ignored";
    case "settling":
      return "converting";
    default:
      // detected, confirming, and anything new they add.
      return "detected";
  }
}

/** Atomic units into something a person reads. Decimals differ per side. */
function human(atomic: unknown, decimals: unknown): string | null {
  // Null is not zero. Number(null) is 0 and passes every finite check, so an
  // amount nobody knows yet rendered as "0 USDC" - which on a deposit screen
  // reads as money that arrived and came to nothing.
  if (atomic === null || atomic === undefined || atomic === "") return null;
  const n = Number(atomic);
  const d = Number(decimals);
  if (!Number.isFinite(n) || !Number.isFinite(d)) return null;
  const v = n / 10 ** d;
  return v.toFixed(Math.min(d, 8)).replace(/0+$/, "").replace(/\.$/, "");
}

export async function routedActivity(userId: string): Promise<RoutedDepositActivity[]> {
  return activityFor(await ensureAccount(userId));
}

/**
 * The same list for somebody who may not be enrolled, creating nothing.
 *
 * Takes the account id when the caller already has it, which the admin does -
 * it reads them all from our own markers - so the common case is one call.
 */
export async function routedActivityReadOnly(
  userId: string,
  accountId?: string,
): Promise<RoutedDepositActivity[]> {
  return activityFor(accountId ?? (await accountIdOnly(userId)));
}

async function activityFor(accountId: string | null): Promise<RoutedDepositActivity[]> {
  if (!accountId) return [];

  const r = await listDeposits(accountId);
  const list: any[] = r.data?.deposits ?? [];

  return list.map((d) => {
    const src = d.amount ?? {};
    const snap = d.settlementProfileSnapshot ?? {};
    return {
      id: String(d.id),
      chainId: Number(src.asset?.chainId ?? 0),
      status: mapStatus(String(d.status ?? "")),
      sentAmount: human(src.amount, src.asset?.decimals),
      sentSymbol: src.asset?.symbol ?? null,
      /**
       * Null until it lands. They compute it from what actually arrived, not
       * from a quote, so there is no figure to show before settlement.
       *
       * It is an object, not an atomic string - {asset, amount}, carrying its
       * own decimals, which need not be the settlement profile's. Reading it
       * as a number gave NaN, so a settled deposit reported nothing received
       * and was written down as zero.
       */
      receivedAmount: human(
        d.netSettlementAmount?.amount,
        d.netSettlementAmount?.asset?.decimals ?? snap.assetDecimals,
      ),
      receivedSymbol: d.netSettlementAmount?.asset?.symbol ?? snap.assetSymbol ?? null,
      sourceTxHash: d.txHash ?? null,
      settlementTxHash: d.settlement?.txHash ?? null,
      /**
       * The whole cost of the conversion, in the asset it is taken from.
       *
       * Three components - network, platform and partner - and they are all
       * denominated in the settlement asset, so they add. Known from the
       * moment the deposit is seen, which makes it the one number a receipt
       * can state truthfully while the amount is still unknown.
       */
      feeAmount: human(
        String(
          BigInt(d.fees?.networkAmountAtomic ?? 0) +
            BigInt(d.fees?.platformAmountAtomic ?? 0) +
            BigInt(d.fees?.partnerAmountAtomic ?? 0),
        ),
        d.fees?.denomination?.decimals,
      ),
      feeSymbol: d.fees?.denomination?.symbol ?? null,
      /**
       * What the swap produced, before the fee was taken out of it.
       *
       * Without it a receipt cannot explain itself: 0.6 USDT arriving as
       * 0.595687 USDC against a stated fee of 0.002993 leaves 0.00132
       * unaccounted for, which is the rate the conversion got rather than a
       * charge anybody levied. Naming both makes the arithmetic close.
       */
      receivedBeforeFee: human(
        d.fees?.actualReceivedAmountAtomic,
        d.fees?.denomination?.decimals,
      ),
      createdAt: d.createdAt ?? null,
      updatedAt: d.updatedAt ?? null,
    };
  });
}

/**
 * This person's converted-deposit addresses, for the console, creating
 * nothing: an account that was never enrolled simply has none. The account id
 * comes from our own marker when we have it, so the usual case is one call.
 */
export async function routedAddressesReadOnly(userId: string): Promise<RoutedAddress[]> {
  const marker = await prisma.serviceStatus.findUnique({ where: { key: ACCT_KEY(userId) }, select: { value: true } });
  const accountId = marker?.value || (await accountIdOnly(userId));
  if (!accountId) return [];
  return readAddresses(accountId);
}
