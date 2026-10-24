import { api } from "./api";

/**
 * Deposits that arrive as something else.
 *
 * Send Bitcoin, hold USDC. The address belongs to a CHAIN rather than a token,
 * which is why the screen is organised by chain too: Ethereum USDC and
 * Ethereum USDT are one address, and showing them as two rows implied two
 * places to send to.
 */

/** Usable, or named on the list and turned off. `hidden` never reaches here. */
export type RoutedAssetState = "visible" | "unavailable";

export interface RoutedAsset {
  chainId: number;
  symbol: string;
  state?: RoutedAssetState;
  address: string;
  /** From the server, per address. Never assume it. */
  minimum: string | null;
  decimals: number | null;
  /** What it becomes, and on which of the person's wallets. Per asset: BTC and Tron land on Solana, the rest on Movement. */
  settlesAs?: string;
  settlesOn?: string;
}

/** Where a routed deposit lands, as a person would say it. */
export const SETTLE_CHAIN_NAME: Record<string, string> = {
  SOL: "Solana",
  MOVE: "Movement",
};

export interface RoutedDeposits {
  assets: RoutedAsset[];
  settlesAs?: string;
  settlesOn?: string;
}

/**
 * One row per address: the chain, and everything it accepts.
 */
export interface RoutedGroup {
  chainId: number;
  address: string;
  assets: RoutedAsset[];
  label: string;
  note: string;
  /** Which logo to draw. The chain's, not the token's. */
  logo: string;
  /**
   * False when nothing on this chain can be sent right now.
   *
   * The row is still drawn - somebody who used it last week should see that it
   * is off rather than wonder whether they imagined it - but it does not open.
   */
  available: boolean;
  /** The wallet it lands in: "Solana" or "Movement". */
  settlesOn: string;
}

export const ROUTED_CHAIN_NAME: Record<number, string> = {
  1: "Ethereum",
  56: "BNB Smart Chain",
  137: "Polygon",
  4663: "Robinhood Chain",
  10001: "Bitcoin",
  10103: "Solana",
  42161: "Arbitrum",
  728126428: "Tron",
};

/**
 * The chain's own mark, not the token's.
 *
 * A row is a network to send on, and the network is the thing somebody has to
 * get right - Tether on Tron and Tether on Ethereum are the same logo and
 * completely different money. The chain badge is what tells them apart.
 */
export const ROUTED_CHAIN_LOGO: Record<number, string> = {
  1: "ETH",
  56: "BNB",
  137: "POL",
  4663: "USDG",
  10001: "BTC",
  10103: "SOL",
  42161: "ARB",
  728126428: "TRX",
};

/**
 * The second line: where it goes.
 *
 * The network belongs here rather than trailed onto the title. "USDC & USDT &
 * ETH on Ethereum" put the one word that decides whether the money arrives at
 * the far end of the longest line on the screen, where it wrapped.
 */
const CHAIN_NOTE: Record<number, string> = {
  1: "Ethereum · ERC-20",
  56: "BNB Smart Chain",
  137: "Polygon",
  4663: "Robinhood Chain",
  10001: "BTC",
  10103: "Solana",
  42161: "Arbitrum · ERC-20",
  728126428: "Tron · TRC-20",
};

/** "A, B & C" - an Oxford list reads as one thing, "A & B & C" as three. */
function listOf(symbols: string[]): string {
  if (symbols.length <= 1) return symbols[0] ?? "";
  return `${symbols.slice(0, -1).join(", ")} & ${symbols[symbols.length - 1]}`;
}

/**
 * What the row is called: what you send, nothing else.
 *
 * A chain whose only asset is its own coin takes the chain's friendlier name -
 * "Bitcoin" rather than "BTC" - and the ticker moves to the line below.
 */
function groupLabel(chainId: number, symbols: string[]): string {
  if (chainId === 10001) return "Bitcoin";
  // "Token", because the coin and the chain share a name and this row is the
  // coin. "Solana" above a Solana address reads as the network - and that
  // address also takes USDC and USDT, so it invites exactly the wrong send.
  if (chainId === 10103 && symbols.length === 1 && symbols[0] === "SOL") return "SOL Token";
  if (chainId === 56 && symbols.length === 1 && symbols[0] === "BNB") return "BNB Token";
  return listOf(symbols);
}

/**
 * Group the flat list into one entry per address.
 *
 * Order comes from the server, so the console decides what leads - except that
 * anything unavailable sinks to the bottom. A dead row wedged between two live
 * ones breaks the scan down the list, and the one people want is never the one
 * they cannot use. Turning it back on returns it to where the console put it.
 *
 * Partitioned rather than sorted, so both halves keep the server's order
 * exactly; a comparator returning 0 leaves that to the engine.
 */
export function groupRouted(assets: RoutedAsset[]): RoutedGroup[] {
  const byChain = new Map<number, RoutedAsset[]>();
  for (const a of assets) {
    const list = byChain.get(a.chainId);
    if (list) list.push(a);
    else byChain.set(a.chainId, [a]);
  }

  const groups = [...byChain.entries()].map(([chainId, list]) => {
    /**
     * The title names what can actually be sent.
     *
     * A chain can have one token on and another off - Ethereum taking USDC
     * while ETH is paused - and "USDC, USDT & ETH" over an address that would
     * ignore the ETH is the kind of label that costs somebody money. When
     * none of them are on, the row is inert and lists them all, because then
     * the title is describing what the row is for rather than what to send.
     */
    const usable = list.filter((a) => a.state !== "unavailable");
    const available = usable.length > 0;
    const named = available ? usable : list;

    return {
      chainId,
      address: list[0].address,
      assets: available ? usable : list,
      label: groupLabel(chainId, named.map((a) => a.symbol)),
      note: CHAIN_NOTE[chainId] ?? ROUTED_CHAIN_NAME[chainId] ?? "",
      logo: ROUTED_CHAIN_LOGO[chainId] ?? list[0].symbol,
      available,
      // One address, one destination: every asset on a chain settles the same way.
      settlesOn: SETTLE_CHAIN_NAME[list[0].settlesOn ?? "MOVE"] ?? "Movement",
    };
  });

  return [...groups.filter((g) => g.available), ...groups.filter((g) => !g.available)];
}

/**
 * The addresses are created on the first of these calls, so it is slower the
 * first time an account opens the screen and instant afterwards.
 */
export async function getRoutedDeposits(): Promise<RoutedDeposits> {
  const res = await api.get("/routed-deposits");
  return res.data;
}

/* ─── What is on its way ────────────────────────────────────────────── */

export type RoutedStatus =
  | "detected"
  | "converting"
  | "settled"
  | "failed"
  | "review"
  | "ignored";

export interface RoutedActivity {
  id: string;
  chainId: number;
  status: RoutedStatus;
  sentAmount: string | null;
  sentSymbol: string | null;
  receivedAmount: string | null;
  receivedSymbol: string | null;
  sourceTxHash: string | null;
  settlementTxHash: string | null;
  feeAmount: string | null;
  feeSymbol: string | null;
  receivedBeforeFee: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function getRoutedActivity(): Promise<RoutedActivity[]> {
  const res = await api.get("/routed-deposits/activity");
  const list: RoutedActivity[] = res.data?.deposits ?? [];
  /**
   * What the provider set aside is not shown.
   *
   * Gas top-ups and dust arrive at the same address as a real deposit and
   * are marked ignored. They are not money on its way anywhere, and a card
   * for one on the screen that tracks arrivals is a transfer somebody has
   * to work out that they can disregard. The admin console still lists
   * them - that is where knowing is useful.
   */
  return list.filter((d) => d.status !== "ignored");
}

/**
 * Where to go and look at it yourself.
 *
 * Keyed by chain id rather than by the app's own chain names, because a routed
 * deposit is identified by the network it was sent on and never by a ticker -
 * the same USDT has a different explorer on Ethereum and on Tron.
 *
 * Returns null for a chain we have no explorer for rather than guessing at a
 * URL: a link that 404s is worse than no link, because it makes the deposit
 * look like it never happened.
 */
const ROUTED_EXPLORER: Record<number, (h: string) => string> = {
  1: (h) => `https://etherscan.io/tx/${h}`,
  56: (h) => `https://bscscan.com/tx/${h}`,
  137: (h) => `https://polygonscan.com/tx/${h}`,
  10001: (h) => `https://mempool.space/tx/${h}`,
  10103: (h) => `https://solscan.io/tx/${h}`,
  42161: (h) => `https://arbiscan.io/tx/${h}`,
  728126428: (h) => `https://tronscan.org/#/transaction/${h}`,
};

export function routedExplorerUrl(chainId: number, hash: string | null): string | null {
  if (!hash) return null;
  return ROUTED_EXPLORER[chainId]?.(hash) ?? null;
}

/** Still moving, so still worth watching. */
export function isRoutedInFlight(s: RoutedStatus): boolean {
  return s === "detected" || s === "converting";
}

/**
 * The line under the track.
 *
 * "review" says neither failed nor checked. The money has arrived and a person
 * is looking at it - saying it failed invites them to write it off, and saying
 * it is being checked invites them to think it is their problem. From where
 * they stand it is simply still going.
 */
export const ROUTED_STATUS_TEXT: Record<RoutedStatus, string> = {
  detected: "Seen on chain. Waiting for enough confirmations.",
  converting: "Converting now. This is the part that takes a few minutes.",
  settled: "Done. It is in your wallet.",
  failed: "This one did not go through. Nothing was converted.",
  review: "Still processing. This one is taking longer than usual.",
  ignored: "Set aside \u2014 this one was not a deposit.",
};
