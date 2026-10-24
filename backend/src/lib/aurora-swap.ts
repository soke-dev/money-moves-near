import crypto from "crypto";
import { ethers } from "ethers";
import { Chain } from "@prisma/client";
import { prisma } from "./prisma";
import { env } from "../config/env";
import { sendNotification } from "./push";
import { getOnChainBalance } from "./balances";
import { tonAddressFromSolana } from "./ton";
import {
  prepareSolanaWithdrawal,
  submitSolanaWithdrawal,
  prepareEvmWithdrawal,
  submitEvmWithdrawal,
  prepareMovementWithdrawal,
  submitMovementWithdrawal,
} from "./gas-sponsor";
import {
  isSwapConfigured,
  swapAssetById,
  liveSwapAssets,
  requestQuote,
  swapStatus,
  submitDepositTx,
  fromBaseUnits,
  type SwapAsset,
  type SwapChain,
  type QuoteRequest,
  type StatusResponse,
} from "./aurora";
import { auroraSettings, type SwapProvider } from "./aurora-settings";

/**
 * A swap: the person's own coins, from their own wallet on one chain, into
 * their own wallet on another.
 *
 * The money path:
 *   1. We ask Aurora for a quote with the person's own addresses as both the
 *      recipient and the refund address. The quote comes with a deposit
 *      address of its own.
 *   2. The app signs a transfer from their wallet to that deposit address,
 *      built by the same gas-sponsored builders a withdrawal uses, and we
 *      broadcast it. Aurora swaps on arrival and pays out to their wallet.
 *   3. Our platform fee is taken from what is sent, never added on top: on
 *      Solana it rides in the same transaction to the sell wallet, so the
 *      two cannot come apart; on the EVM chains it is a second transfer to
 *      the sell address, signed right after the swap's deposit goes out.
 *
 * Recorded as one SWEEP row with metadata.kind "swap", so it needs no new
 * transaction type (and no migration): the app already calls SWEEP rows a
 * swap. The row's asset, chain and amount are where the money ARRIVES, the
 * same as a sweep's; where it came from lives in metadata.
 */

export const EVM_SWAP_CHAINS: SwapChain[] = ["BASE", "BEP20", "MONAD"];
const EVM_WALLET_CHAINS: Chain[] = ["BASE", "BEP20", "ARB", "ARC", "MONAD"];
const isEvm = (c: SwapChain) => EVM_SWAP_CHAINS.includes(c);

export class SwapError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "SwapError";
  }
}

/** The person's own address on a chain, from the stored wallet rows only. */
export async function ownAddressOn(userId: string, chain: SwapChain): Promise<string | null> {
  if (chain === "TON") {
    const ton = await prisma.wallet.findFirst({ where: { userId, chain: "TON", address: { not: null } }, select: { address: true } });
    if (ton?.address) return ton.address;
    // A TON address is a pure function of the Solana key, so the stored
    // Solana row is as good as a TON one.
    const sol = await prisma.wallet.findFirst({ where: { userId, chain: "SOL", address: { not: null } }, select: { address: true } });
    return sol?.address ? tonAddressFromSolana(sol.address) : null;
  }
  const w = await prisma.wallet.findFirst({
    where: { userId, chain: isEvm(chain) ? { in: EVM_WALLET_CHAINS } : (chain as Chain), address: { not: null } },
    select: { address: true },
  });
  return w?.address ?? null;
}

type LiveAsset = SwapAsset & { decimals: number; price: number };

/** Six places is finer than any stablecoin fee needs, and what the builders accept. */
const round6 = (n: number) => Math.floor(n * 1e6) / 1e6;

/** Dollar coins, valued at face for the minimum and the flat fee. */
const isStable = (a: { asset: string }) => a.asset === "USDC" || a.asset === "USDT" || a.asset === "USDCx";

export type SwapPlan = {
  from: LiveAsset;
  to: LiveAsset;
  /** What leaves the wallet in total. */
  amount: number;
  /** Our fee, out of `amount`: the percentage, plus the flat part on Solana. */
  fee: number;
  feeBps: number;
  /** The flat part of `fee`, in the coin sent. Zero off Solana. */
  feeFlat: number;
  /** What is swapped: amount less the fee. */
  net: number;
  usd: number;
  originAddress: string;
  recipientAddress: string;
  /** A routed swap's refund address: the person's own wallet on the chain it routes through. */
  routeRefundAddress?: string;
};

/** Everything checked before Aurora is asked anything. */
export async function planSwap(userId: string, fromId: string, toId: string, amount: number): Promise<SwapPlan> {
  if (!isSwapConfigured()) throw new SwapError("Swaps are not available right now.", 503);
  const settings = (await auroraSettings()).swap;
  if (!settings.enabled) throw new SwapError("Swaps are paused right now. Please try again later.", 503);

  const assets = await liveSwapAssets();
  const from = assets.find((a) => a.id === fromId);
  const to = assets.find((a) => a.id === toId);
  if (!from || !from.from) throw new SwapError("That coin can't be swapped from.");
  if (!to || !to.to) throw new SwapError("That coin can't be swapped to.");
  if (from.id === to.id) throw new SwapError("Pick two different coins.");
  if (!Number.isFinite(amount) || amount <= 0) throw new SwapError("Enter an amount.");

  // A stablecoin counts as its face value: the minimum is "$5", and 5 USDC is
  // $5 to the person typing it, whatever the feed's 0.9998 says.
  const usd = isStable(from) ? amount : amount * from.price;
  if (usd + 1e-9 < settings.minUsd) {
    throw new SwapError(`The smallest swap is $${settings.minUsd}.`);
  }
  if (usd > settings.maxUsd + 1e-9) {
    throw new SwapError(`The largest swap right now is $${settings.maxUsd}.`);
  }

  // A swap paid from Solana also carries a flat fee: it sends to a new deposit
  // address whose USDC account we pay to open. In the coin sent, at its price.
  const flat =
    from.chain === "SOL" && settings.solanaFlatUsd > 0
      ? round6(isStable(from) ? settings.solanaFlatUsd : settings.solanaFlatUsd / from.price)
      : 0;
  const fee = round6((amount * settings.feeBps) / 10_000 + flat);
  const net = round6(amount - fee);
  if (net <= 0) throw new SwapError("That amount is too small to swap.");

  const [originAddress, recipientAddress] = await Promise.all([
    ownAddressOn(userId, from.chain),
    ownAddressOn(userId, to.chain),
  ]);
  if (!originAddress) throw new SwapError(`No wallet found on ${from.chain}.`);
  if (!recipientAddress) throw new SwapError(`No wallet found on ${to.chain}.`);

  let routeRefundAddress: string | undefined;
  if (from.via) {
    routeRefundAddress = (await ownAddressOn(userId, from.via)) ?? undefined;
    if (!routeRefundAddress) throw new SwapError("Set up your Base wallet first.");
  }

  return { from, to, amount, fee, feeBps: settings.feeBps, feeFlat: flat, net, usd, originAddress, recipientAddress, routeRefundAddress };
}

/**
 * The exact units the withdrawal builder will put on chain for `net`.
 *
 * An EXACT_INPUT quote refunds a deposit that is even one unit short, so the
 * quoted amount is computed with the builder's own arithmetic rather than
 * ours: Math.floor on Solana's six decimals, toFixed + parseUnits on the EVM
 * tokens. Rounded "correctly" it could differ - 0.29 USDC floors to 289999
 * units in the builder - and the swap would come back as underpaid.
 */
function sentUnits(chain: SwapChain, net: number, decimals: number): string {
  if (chain === "SOL") return BigInt(Math.floor(net * 10 ** 6)).toString();
  return ethers.parseUnits(net.toFixed(decimals), decimals).toString();
}

function quoteBody(plan: SwapPlan, dry: boolean, slippageBps: number): QuoteRequest {
  // Routed: our wallet sends USDC on Base onward, so that is what is quoted,
  // and a refund lands in the person's own Base wallet.
  const routed = !!plan.from.via;
  return {
    dry,
    swapType: "EXACT_INPUT",
    depositType: "ORIGIN_CHAIN",
    depositMode: "SIMPLE",
    amount: routed ? sentUnits("BASE", plan.net, 6) : sentUnits(plan.from.chain, plan.net, plan.from.decimals),
    originAsset: routed ? ROUTE_USDC.assetId : plan.from.assetId,
    destinationAsset: plan.to.assetId,
    slippageTolerance: slippageBps,
    // Both ends are the person's own wallet: a failed swap goes back to the
    // address it came from, and a finished one lands in theirs.
    refundTo: routed ? plan.routeRefundAddress! : plan.originAddress,
    refundType: "ORIGIN_CHAIN",
    recipient: plan.recipientAddress,
    recipientType: "DESTINATION_CHAIN",
  };
}

export type QuoteView = {
  from: string;
  to: string;
  amount: number;
  fee: number;
  feeBps: number;
  feeFlat: number;
  net: number;
  amountOut: number;
  minAmountOut: number;
  amountOutUsd: number | null;
  rate: number;
  timeEstimate: number;
  minUsd: number;
};

function viewOf(plan: SwapPlan, quote: { amountOut: string; minAmountOut: string; amountOutUsd?: string; timeEstimate: number }, minUsd: number): QuoteView {
  const amountOut = fromBaseUnits(quote.amountOut, plan.to.decimals);
  return {
    from: plan.from.id,
    to: plan.to.id,
    amount: plan.amount,
    fee: plan.fee,
    feeBps: plan.feeBps,
    feeFlat: plan.feeFlat,
    net: plan.net,
    amountOut,
    minAmountOut: fromBaseUnits(quote.minAmountOut, plan.to.decimals),
    amountOutUsd: quote.amountOutUsd ? Number(quote.amountOutUsd) : null,
    rate: plan.net > 0 ? amountOut / plan.net : 0,
    timeEstimate: quote.timeEstimate,
    minUsd,
  };
}

/** A price to show. Nothing is reserved and no deposit address exists. */
export async function previewSwap(userId: string, fromId: string, toId: string, amount: number): Promise<QuoteView> {
  const plan = await planSwap(userId, fromId, toId, amount);
  const settings = (await auroraSettings()).swap;
  if (plan.from.via) {
    await assertRouteCovers(plan.net);
    return routedView(plan, settings);
  }
  const r = await requestQuote(quoteBody(plan, true, settings.slippageBps));
  if (!r.ok || !r.data?.quote) throw new SwapError(quoteError(r.status, r.error), r.status === 429 ? 429 : 502);
  return viewOf(plan, r.data.quote, settings.minUsd);
}

function quoteError(status: number, error?: string): string {
  if (status === 429) return "Too many price checks. Wait a few seconds and try again.";
  if (error && /amount.*(too )?(low|small)|minimum/i.test(error)) return "That amount is below what this route accepts. Try a larger amount.";
  return "Couldn't get a price for that swap right now. Please try again.";
}

/** Swaps this person started in the last day. Each costs us gas, so they are rationed. */
async function swapsToday(userId: string): Promise<number> {
  return prisma.transaction.count({
    where: {
      userId,
      type: "SWEEP",
      metadata: { path: ["kind"], equals: "swap" },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
      status: { not: "CANCELLED" },
    },
  });
}

export type PreparedSwap = {
  swapId: string;
  chain: SwapChain;
  signingMessage: string;
  txRequest?: Record<string, string | number>;
  /** True when the fee is a second transfer the app signs after this one (EVM). */
  feeLegFollows: boolean;
  quote: QuoteView & { deadline: string | null };
};

/**
 * Commit to a swap: a real quote with a deposit address, a PENDING row, and
 * the transfer for the app to sign. Nothing moves until it is signed.
 */
export async function prepareSwap(userId: string, fromId: string, toId: string, amount: number): Promise<PreparedSwap> {
  const plan = await planSwap(userId, fromId, toId, amount);
  const settings = (await auroraSettings()).swap;

  if ((await swapsToday(userId)) >= settings.perDay) {
    throw new SwapError(`You've reached today's limit of ${settings.perDay} swaps. Try again tomorrow.`, 429);
  }

  // The chain's word, not our database's: only what the wallet really holds can be spent.
  let onChain: number;
  try {
    onChain = await getOnChainBalance(plan.from.asset, plan.from.chain, plan.originAddress);
  } catch {
    throw new SwapError("Couldn't check your balance. Please try again.", 503);
  }
  if (onChain + 1e-9 < plan.amount) throw new SwapError("Not enough balance for this swap.");

  if (isEvm(plan.from.chain)) await assertFeesPaid(userId);
  if (plan.from.via) return prepareRoutedSwap(userId, plan, settings);

  const r = await requestQuote(quoteBody(plan, false, settings.slippageBps));
  const q = r.data?.quote;
  if (!r.ok || !q?.depositAddress) throw new SwapError(quoteError(r.status, r.error), r.status === 429 ? 429 : 502);

  // Solana's fee rides in the same transaction; without a sell wallet there is
  // nowhere for it to go, and the swap goes ahead without one rather than failing.
  const solFee = plan.from.chain === "SOL" && env.SELL_SOLANA_ADDRESS ? plan.fee : 0;
  const view = viewOf(plan, q, settings.minUsd);

  const tx = await prisma.transaction.create({
    data: {
      userId,
      type: "SWEEP",
      asset: plan.to.asset,
      chain: plan.to.chain as Chain,
      amount: view.amountOut,
      fee: 0,
      status: "PENDING",
      reference: `SWP-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`,
      metadata: {
        kind: "swap",
        from: { id: plan.from.id, asset: plan.from.asset, chain: plan.from.chain, symbol: plan.from.symbol, amount: plan.amount, net: plan.net, address: plan.originAddress },
        to: { id: plan.to.id, asset: plan.to.asset, chain: plan.to.chain, symbol: plan.to.symbol, expected: view.amountOut, minimum: view.minAmountOut, address: plan.recipientAddress },
        fee: {
          amount: plan.fee,
          symbol: plan.from.symbol,
          bps: plan.feeBps,
          flat: plan.feeFlat,
          // Solana's is collected with the deposit or not at all; EVM's is its own transfer.
          via: plan.from.chain === "SOL" ? "same_tx" : "second_tx",
          collected: false,
          ...(plan.from.chain === "SOL" && !solFee ? { skipped: "no sell wallet" } : {}),
        },
        depositAddress: q.depositAddress,
        ...(q.depositMemo ? { depositMemo: q.depositMemo } : {}),
        // Its status is asked of whoever quoted it, whatever the console says later.
        provider: r.provider,
        deadline: q.deadline ?? null,
        timeEstimate: q.timeEstimate,
        slippageBps: settings.slippageBps,
        quoteCorrelationId: r.data?.correlationId ?? null,
        swapStatus: "AWAITING_SIGNATURE",
      },
    },
  });

  try {
    if (plan.from.chain === "SOL") {
      const { signingMessage } = await prepareSolanaWithdrawal(
        tx.id,
        plan.originAddress,
        q.depositAddress,
        plan.net,
        plan.from.asset as "USDC" | "USDT",
        solFee,
      );
      return { swapId: tx.id, chain: "SOL", signingMessage, feeLegFollows: false, quote: { ...view, deadline: q.deadline ?? null } };
    }
    const { signingMessage, txRequest } = await prepareEvmWithdrawal(
      tx.id,
      plan.originAddress,
      q.depositAddress,
      plan.net,
      plan.from.asset as "USDC" | "USDT",
      plan.from.chain as "BASE" | "BEP20" | "MONAD",
    );
    return {
      swapId: tx.id,
      chain: plan.from.chain,
      signingMessage,
      txRequest,
      feeLegFollows: plan.fee > 0,
      quote: { ...view, deadline: q.deadline ?? null },
    };
  } catch (err: any) {
    await prisma.transaction
      .update({ where: { id: tx.id }, data: { status: "CANCELLED", metadata: { ...(tx.metadata as any), chainError: err?.message || "Could not build the transfer" } } })
      .catch(() => {});
    if (err?.name === "AtaRentRefused") throw new SwapError(err.message);
    throw new SwapError("Couldn't prepare this swap. Please try again.", 500);
  }
}

const meta = (t: { metadata: unknown }) => (t.metadata ?? {}) as any;

/**
 * On the EVM chains our fee is a second transfer the app signs after the swap
 * has gone, so an app that simply never signs it swaps for free. One missed
 * fee is an accident - a crash between the two signatures. Two where the app
 * never even tried (no error recorded from an attempt) is a pattern, and the
 * account stops swapping from those chains until support looks.
 */
async function assertFeesPaid(userId: string) {
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      type: "SWEEP",
      status: { in: ["PROCESSING", "COMPLETED"] },
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60_000), lte: new Date(Date.now() - 10 * 60_000) },
      AND: [
        { metadata: { path: ["kind"], equals: "swap" } },
        { metadata: { path: ["fee", "via"], equals: "second_tx" } },
      ],
    },
    select: { metadata: true },
    take: 100,
  });
  const skipped = rows.map(meta).filter((m) => m.fee?.amount > 0 && !m.fee?.collected && !m.fee?.error && !m.fee?.waived).length;
  if (skipped >= 2) {
    throw new SwapError("Fees on your earlier swaps did not go through, so swaps from this network are paused for your account. Contact support to sort it out.", 403);
  }
}

/** Lower the cached balance of the coin that left. Bookkeeping only: payouts never read it. */
async function debit(userId: string, asset: string, chain: string, amount: number) {
  if (amount <= 0) return;
  await prisma.wallet
    .update({
      where: { userId_asset_chain: { userId, asset: asset as any, chain: chain as Chain } },
      data: { balance: { decrement: amount } },
    })
    .catch(() => {});
}

export type SubmitResult = {
  status: "PROCESSING";
  txHash: string;
  feeLeg?: { signingMessage: string; txRequest?: Record<string, string | number> };
};

/** Broadcast the signed deposit transfer. Claimed first, so a double tap cannot send twice. */
export async function submitSwap(
  userId: string,
  swapId: string,
  sig: { signature: string; publicKey: string; signedRaw?: string },
): Promise<SubmitResult> {
  const claimed = await prisma.transaction.updateMany({
    where: { id: swapId, userId, type: "SWEEP", status: "PENDING" },
    data: { status: "PROCESSING" },
  });
  if (claimed.count === 0) {
    const existing = await prisma.transaction.findFirst({ where: { id: swapId, userId }, select: { id: true } });
    throw new SwapError(existing ? "This swap was already sent." : "Swap not found.", existing ? 409 : 404);
  }
  const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: swapId } });
  const m = meta(tx);
  if (m.kind !== "swap") throw new SwapError("Swap not found.", 404);
  if (m.route === ROUTE) return submitRoutedSwap(userId, swapId, m, sig);

  let txHash: string;
  try {
    txHash =
      m.from.chain === "SOL"
        ? await submitSolanaWithdrawal(swapId, sig.signature, sig.publicKey)
        : await submitEvmWithdrawal(swapId, sig.signature, sig.publicKey, sig.signedRaw);
  } catch (err: any) {
    await prisma.transaction.update({
      where: { id: swapId },
      data: {
        status: "FAILED",
        metadata: { ...m, swapStatus: "SEND_FAILED", chainError: err?.message || "On-chain submit failed", ...(err?.txHash ? { originTxHash: err.txHash } : {}) },
      },
    });
    const expired = /expired or not found/i.test(err?.message || "");
    throw new SwapError(expired ? "This swap took too long to confirm. Nothing was sent. Please start again." : "The transfer couldn't be sent. Nothing left your wallet.", 500);
  }

  const solFeeCollected = m.from.chain === "SOL" && m.fee?.amount > 0 && !m.fee?.skipped;
  const next = {
    ...m,
    originTxHash: txHash,
    swapStatus: "PENDING_DEPOSIT",
    fee: { ...m.fee, ...(solFeeCollected ? { collected: true, txHash } : {}) },
  };
  await prisma.transaction.update({ where: { id: swapId }, data: { metadata: next } });
  await debit(userId, m.from.asset, m.from.chain, m.from.chain === "SOL" ? m.from.net + (solFeeCollected ? m.fee.amount : 0) : m.from.net);

  // Optional, only ever faster. Never waited on.
  submitDepositTx(txHash, m.depositAddress, m.depositMemo, m.provider ?? "aurora").catch(() => {});

  // The EVM fee: a second transfer, built now that the deposit is in the
  // mempool so its nonce comes after the deposit's.
  if (m.from.chain !== "SOL" && m.fee?.amount > 0) {
    try {
      const { signingMessage, txRequest } = await prepareEvmWithdrawal(
        `${swapId}:fee`,
        m.from.address,
        env.SELL_EVM_ADDRESS,
        m.fee.amount,
        m.from.asset,
        m.from.chain,
      );
      return { status: "PROCESSING", txHash, feeLeg: { signingMessage, txRequest } };
    } catch (err: any) {
      // The swap is already on its way. A fee we could not build is ours to
      // lose, never a reason to tell the person their swap failed.
      console.error(`[SWAP] fee leg build failed for ${swapId}:`, err?.message);
      await prisma.transaction.update({ where: { id: swapId }, data: { metadata: { ...next, fee: { ...next.fee, error: err?.message || "build failed" } } } }).catch(() => {});
    }
  }
  return { status: "PROCESSING", txHash };
}

/** Broadcast the signed EVM fee transfer. Best effort: the swap stands either way. */
export async function submitSwapFee(
  userId: string,
  swapId: string,
  sig: { signature: string; publicKey: string; signedRaw?: string },
): Promise<{ collected: boolean }> {
  const tx = await prisma.transaction.findFirst({ where: { id: swapId, userId, type: "SWEEP" } });
  const m = tx ? meta(tx) : null;
  if (!tx || m?.kind !== "swap") throw new SwapError("Swap not found.", 404);
  if (m.fee?.collected) return { collected: true };
  if (m.from.chain === "SOL") return { collected: false };

  try {
    const feeHash = await submitEvmWithdrawal(`${swapId}:fee`, sig.signature, sig.publicKey, sig.signedRaw);
    const fresh = meta(await prisma.transaction.findUniqueOrThrow({ where: { id: swapId } }));
    const { error: _cleared, ...feeRest } = fresh.fee ?? {};
    await prisma.transaction.update({
      where: { id: swapId },
      data: { metadata: { ...fresh, fee: { ...feeRest, collected: true, txHash: feeHash } } },
    });
    await debit(userId, m.from.asset, m.from.chain, m.fee.amount);
    return { collected: true };
  } catch (err: any) {
    console.error(`[SWAP] fee leg submit failed for ${swapId}:`, err?.message);
    const fresh = meta(await prisma.transaction.findUniqueOrThrow({ where: { id: swapId } }));
    await prisma.transaction
      .update({ where: { id: swapId }, data: { metadata: { ...fresh, fee: { ...fresh.fee, error: err?.message || "submit failed" } } } })
      .catch(() => {});
    return { collected: false };
  }
}

/* ─── Following a swap ─────────────────────────────────────────────── */

const ROW_STATUS: Record<StatusResponse["status"], "PROCESSING" | "COMPLETED" | "REFUNDED" | "FAILED"> = {
  PENDING_DEPOSIT: "PROCESSING",
  KNOWN_DEPOSIT_TX: "PROCESSING",
  INCOMPLETE_DEPOSIT: "PROCESSING",
  PROCESSING: "PROCESSING",
  SUCCESS: "COMPLETED",
  REFUNDED: "REFUNDED",
  FAILED: "FAILED",
};

/** Their guidance: poll every five to ten seconds; faster does not speed settlement. */
const MIN_CHECK_GAP_MS = 5_000;

/**
 * Ask Aurora where a swap is, and write it down. Cheap to call often: within
 * a few seconds of the last check it answers from the row.
 */
export async function refreshSwap(swapId: string) {
  const tx = await prisma.transaction.findUnique({ where: { id: swapId } });
  if (!tx) return null;
  const m = meta(tx);
  if (m.kind !== "swap" || tx.status !== "PROCESSING" || !m.originTxHash) return tx;
  if (m.route === ROUTE) {
    if (m.swapStatus === "ROUTING") {
      await routeOnward(swapId);
      return prisma.transaction.findUnique({ where: { id: swapId } });
    }
    // A payout claimed and never written down: whether it went is unknown, so a person looks.
    if (m.swapStatus === "PAYING") {
      if (Date.now() - Date.parse(m.payingAt ?? "") > 10 * 60_000) {
        // The onward payment may have gone out with its record lost: ask before calling it held.
        const seen = m.depositAddress ? await swapStatus(m.depositAddress, undefined, m.provider ?? "aurora") : null;
        if (seen?.ok && seen.data && seen.data.status !== "PENDING_DEPOSIT") {
          await prisma.transaction.update({ where: { id: swapId }, data: { metadata: { ...m, swapStatus: seen.data.status } } });
        } else {
          await holdRouted(swapId, m, "payout never confirmed");
        }
      }
      return prisma.transaction.findUnique({ where: { id: swapId } });
    }
    if (m.swapStatus === "HELD" || !m.depositAddress) return tx;
  }
  if (m.statusCheckedAt && Date.now() - Date.parse(m.statusCheckedAt) < MIN_CHECK_GAP_MS) return tx;

  const r = await swapStatus(m.depositAddress, m.depositMemo, m.provider ?? "aurora");
  if (!r.ok || !r.data) {
    await prisma.transaction.update({ where: { id: swapId }, data: { metadata: { ...m, statusCheckedAt: new Date().toISOString() } } }).catch(() => {});
    return tx;
  }

  const s = r.data;
  const status = ROW_STATUS[s.status] ?? "PROCESSING";
  const d = s.swapDetails ?? ({} as StatusResponse["swapDetails"]);
  const destHash = d.destinationChainTxHashes?.[0]?.hash;
  const toDecimals = (await liveSwapAssets()).find((a) => a.id === m.to.id)?.decimals;
  const amountOut =
    d.amountOut && toDecimals !== undefined ? fromBaseUnits(d.amountOut, toDecimals) : d.amountOutFormatted ? Number(d.amountOutFormatted) : null;

  const next = {
    ...m,
    swapStatus: s.status,
    statusCheckedAt: new Date().toISOString(),
    ...(destHash ? { txHash: destHash, destinationExplorerUrl: d.destinationChainTxHashes[0].explorerUrl } : {}),
    ...(d.originChainTxHashes?.length ? { originExplorerUrl: d.originChainTxHashes[0].explorerUrl } : {}),
    ...(d.refundedAmountFormatted ? { refundedAmount: Number(d.refundedAmountFormatted) } : {}),
    ...(d.refundReason ? { refundReason: d.refundReason } : {}),
    ...(status === "COMPLETED" ? { completedAt: s.updatedAt } : {}),
  };

  // Conditional on still being PROCESSING: the app's polling and the
  // background job can both get here, and only one of them may finish it.
  const { count } = await prisma.transaction.updateMany({
    where: { id: swapId, status: "PROCESSING" },
    data: {
      status,
      metadata: next,
      ...(status === "COMPLETED" && amountOut !== null ? { amount: amountOut } : {}),
    },
  });

  if (count === 1 && status !== "PROCESSING") await finish(tx.userId, tx.id, status, next, amountOut);
  return prisma.transaction.findUnique({ where: { id: swapId } });
}

/** The crossing out of PROCESSING, once: tidy the history and tell the person. */
async function finish(userId: string, swapId: string, status: "COMPLETED" | "REFUNDED" | "FAILED", m: any, amountOut: number | null) {
  if (status === "COMPLETED" && m.txHash) {
    // The chain watcher may have written the arrival as its own deposit first.
    // It is this swap's money, so that row goes.
    const dup = await prisma.transaction.findFirst({
      where: { userId, id: { not: swapId }, metadata: { path: ["txHash"], equals: m.txHash } },
      select: { id: true },
    });
    if (dup) await prisma.transaction.delete({ where: { id: dup.id } }).catch(() => {});
  }

  const toLabel = `${m.to.symbol} on ${CHAIN_NAME[m.to.chain] ?? m.to.chain}`;
  const body =
    status === "COMPLETED"
      ? `${(amountOut ?? m.to.expected).toFixed(2)} ${toLabel} is in your wallet.`
      : status === "REFUNDED"
        ? m.route === ROUTE
          ? `Your swap didn't go through. ${m.refundedAmount ?? m.from.net} USDC was returned to your Base wallet.`
          : `Your swap didn't go through. ${m.refundedAmount ?? m.from.net} ${m.from.symbol} went back to your wallet.`
        : "Your swap didn't go through. If anything left your wallet, it is being returned.";
  await sendNotification({
    userId,
    type: "transaction",
    title: status === "COMPLETED" ? "Swap complete" : "Swap not completed",
    body,
  }).catch(() => {});
}

const CHAIN_NAME: Record<string, string> = { SOL: "Solana", BASE: "Base", BEP20: "BNB Chain", MONAD: "Monad", TON: "TON", MOVE: "Movement" };

let refreshing = false;

/** Finish swaps nobody is watching, so the row and the notification do not wait for the app. */
export async function refreshInFlightSwaps(): Promise<void> {
  if (refreshing || !isSwapConfigured()) return;
  refreshing = true;
  try {
    /**
     * Never signed: gone, not failed.
     *
     * Backing out at the review leaves a PENDING row, and the stale-transaction
     * job would mark it FAILED after ten minutes - a "failed swap" in somebody's
     * history for a swap they chose not to send, counted against their daily
     * limit too. Nothing left their wallet, so there is nothing to record. Five
     * minutes is long past the two that a signing payload lives.
     */
    await prisma.transaction.deleteMany({
      where: {
        type: "SWEEP",
        status: "PENDING",
        createdAt: { lt: new Date(Date.now() - 5 * 60_000) },
        AND: [
          { metadata: { path: ["kind"], equals: "swap" } },
          { metadata: { path: ["swapStatus"], equals: "AWAITING_SIGNATURE" } },
        ],
      },
    });
    const rows = await prisma.transaction.findMany({
      where: {
        type: "SWEEP",
        status: "PROCESSING",
        metadata: { path: ["kind"], equals: "swap" },
        createdAt: { gte: new Date(Date.now() - 3 * 24 * 60 * 60_000) },
      },
      select: { id: true },
      take: 100,
    });
    for (const r of rows) await refreshSwap(r.id).catch(() => {});
  } finally {
    refreshing = false;
  }
}

/** What the app shows for one swap. */
export function swapView(tx: { id: string; status: string; amount: unknown; createdAt: Date; metadata: unknown }) {
  const m = meta(tx);
  return {
    id: tx.id,
    status: tx.status,
    swapStatus: m.swapStatus ?? null,
    from: m.from,
    to: m.to,
    fee: m.fee ? { amount: m.fee.amount, symbol: m.fee.symbol, bps: m.fee.bps, collected: !!m.fee.collected } : null,
    amountOut: Number(tx.amount),
    originTxHash: m.originTxHash ?? null,
    destinationTxHash: m.txHash && m.txHash !== m.originTxHash ? m.txHash : null,
    originExplorerUrl: m.originExplorerUrl ?? null,
    destinationExplorerUrl: m.destinationExplorerUrl ?? null,
    refundedAmount: m.refundedAmount ?? null,
    // Taken, and being finished by hand: the app says so rather than "failed".
    held: m.swapStatus === "HELD",
    timeEstimate: m.timeEstimate ?? null,
    createdAt: tx.createdAt,
    completedAt: m.completedAt ?? null,
  };
}

/* ─── Out of Movement, through our own wallets ─────────────────────── */

/**
 * Movement has no liquidity on the network, so its USDCx is routed:
 *
 *   1. The person sends USDCx to our Movement swap wallet (SWAP_MOVEMENT_ADDRESS),
 *      signed in the app with the gas sponsored. Our fee is kept there.
 *   2. Once that transfer is confirmed on chain, our Base swap wallet
 *      (SWAP_EVM_PRIVATE_KEY) pays: straight to their Base wallet if Base USDC
 *      is what they asked for, otherwise to a fresh quote's deposit address,
 *      which swaps it on to the chain and coin they chose. A refund of that
 *      onward leg goes to their own Base wallet.
 *   3. From there it is followed like any other swap.
 *
 * Base, because a send there costs a fraction of a cent and opens no account,
 * so the person pays our percentage and nothing else.
 *
 * The states, in metadata.swapStatus: ROUTING (their USDCx is in, nothing paid
 * yet) -> PAYING (claimed, the payout is being sent) -> PENDING_DEPOSIT and on
 * as usual, or SUCCESS straight away for Base. HELD means their coins are in
 * and the payout needs a person: it is never retried automatically, because a
 * retry that was wrong about the first send would pay twice.
 */
const ROUTE = "via-base";
const ROUTE_USDC = swapAssetById("BASE:USDC")!;
const BASE_USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** The Base swap wallet's address, worked out from its key. Null when unset. */
export function routeWalletAddress(): string | null {
  if (!env.SWAP_EVM_PRIVATE_KEY) return null;
  try {
    return new ethers.Wallet(env.SWAP_EVM_PRIVATE_KEY).address;
  } catch {
    return null;
  }
}

/**
 * What the Base swap wallet can still promise: its live USDC, less what routed
 * swaps already in flight have been promised and not yet paid. A live read,
 * never a stored balance.
 */
async function routeHeadroom(): Promise<number> {
  const address = routeWalletAddress();
  if (!address) return 0;
  let live: number;
  try {
    live = await getOnChainBalance("USDC", "BASE", address);
  } catch {
    return 0;
  }
  /**
   * Promised: everything their USDCx has already reached us for, and anything
   * prepared in the last three minutes that could still be signed. A prepared
   * transfer expires in two, so an older unsigned one can never arrive - and
   * counting those let one person reserve the whole wallet by preparing swaps
   * and never sending them.
   */
  const open = await prisma.transaction.findMany({
    where: {
      type: "SWEEP",
      AND: [{ metadata: { path: ["route"], equals: ROUTE } }],
      OR: [
        { status: "PROCESSING", createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } },
        { status: "PENDING", createdAt: { gte: new Date(Date.now() - 3 * 60_000) } },
      ],
    },
    select: { metadata: true },
  });
  const promised = open
    .map((r) => meta(r))
    .filter((m) => !m.payoutTxHash && m.swapStatus !== "HELD")
    .reduce((n, m) => n + Number(m.from?.net || 0), 0);
  return live - promised;
}

async function assertRouteCovers(net: number) {
  if ((await routeHeadroom()) + 1e-9 < net) {
    throw new SwapError("Swaps from Movement aren't available right now. Please try again later.", 503);
  }
}

/** The price to show for a routed swap: Base is one to one, anything else is quoted onward. */
async function routedView(plan: SwapPlan, settings: { slippageBps: number; minUsd: number }): Promise<QuoteView> {
  if (plan.to.id === ROUTE_USDC.id) {
    return {
      from: plan.from.id,
      to: plan.to.id,
      amount: plan.amount,
      fee: plan.fee,
      feeBps: plan.feeBps,
      feeFlat: plan.feeFlat,
      net: plan.net,
      amountOut: plan.net,
      minAmountOut: plan.net,
      amountOutUsd: plan.net,
      rate: 1,
      timeEstimate: 20,
      minUsd: settings.minUsd,
    };
  }
  const r = await requestQuote(quoteBody(plan, true, settings.slippageBps));
  if (!r.ok || !r.data?.quote) throw new SwapError(quoteError(r.status, r.error), r.status === 429 ? 429 : 502);
  return viewOf(plan, r.data.quote, settings.minUsd);
}

async function prepareRoutedSwap(
  userId: string,
  plan: SwapPlan,
  settings: { slippageBps: number; minUsd: number },
): Promise<PreparedSwap> {
  await assertRouteCovers(plan.net);
  const view = await routedView(plan, settings);

  const tx = await prisma.transaction.create({
    data: {
      userId,
      type: "SWEEP",
      asset: plan.to.asset as any,
      chain: plan.to.chain as Chain,
      amount: view.amountOut,
      fee: 0,
      status: "PENDING",
      reference: `SWP-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`,
      metadata: {
        kind: "swap",
        route: ROUTE,
        from: { id: plan.from.id, asset: plan.from.asset, chain: plan.from.chain, symbol: plan.from.symbol, amount: plan.amount, net: plan.net, address: plan.originAddress },
        to: { id: plan.to.id, asset: plan.to.asset, chain: plan.to.chain, symbol: plan.to.symbol, assetId: plan.to.assetId, expected: view.amountOut, minimum: view.minAmountOut, address: plan.recipientAddress },
        // Kept: they send the whole amount to our Movement wallet and we pay out the rest.
        fee: { amount: plan.fee, symbol: plan.from.symbol, bps: plan.feeBps, flat: 0, via: "kept", collected: false },
        receiveAddress: env.SWAP_MOVEMENT_ADDRESS,
        refundAddress: plan.routeRefundAddress,
        timeEstimate: view.timeEstimate,
        slippageBps: settings.slippageBps,
        swapStatus: "AWAITING_SIGNATURE",
      },
    },
  });

  try {
    const { signingMessage } = await prepareMovementWithdrawal(tx.id, plan.originAddress, env.SWAP_MOVEMENT_ADDRESS, plan.amount, "USDCx");
    return { swapId: tx.id, chain: "MOVE", signingMessage, feeLegFollows: false, quote: { ...view, deadline: null } };
  } catch (err: any) {
    await prisma.transaction
      .update({ where: { id: tx.id }, data: { status: "CANCELLED", metadata: { ...(tx.metadata as any), chainError: err?.message || "Could not build the transfer" } } })
      .catch(() => {});
    throw new SwapError("Couldn't prepare this swap. Please try again.", 500);
  }
}

async function submitRoutedSwap(
  userId: string,
  swapId: string,
  m: any,
  sig: { signature: string; publicKey: string },
): Promise<SubmitResult> {
  let txHash: string;
  try {
    // Confirmed on chain before it returns: nothing is paid out against a transfer that might not land.
    txHash = await submitMovementWithdrawal(swapId, sig.signature, sig.publicKey);
  } catch (err: any) {
    await prisma.transaction.update({
      where: { id: swapId },
      data: {
        status: "FAILED",
        metadata: { ...m, swapStatus: "SEND_FAILED", chainError: err?.message || "On-chain submit failed", ...(err?.txHash ? { originTxHash: err.txHash } : {}) },
      },
    });
    const expired = /expired or not found/i.test(err?.message || "");
    throw new SwapError(expired ? "This swap took too long to confirm. Nothing was sent. Please start again." : "The transfer couldn't be sent. Nothing left your wallet.", 500);
  }

  await prisma.transaction.update({
    where: { id: swapId },
    data: { metadata: { ...m, originTxHash: txHash, swapStatus: "ROUTING", fee: { ...m.fee, collected: true, txHash } } },
  });
  await debit(userId, m.from.asset, m.from.chain, m.from.amount);

  // The payout runs on its own; the app follows it by polling, and the
  // background job picks it up if this process stops first.
  routeOnward(swapId).catch((e: any) => console.error(`[SWAP] route ${swapId}:`, e?.message));
  return { status: "PROCESSING", txHash };
}

async function holdRouted(swapId: string, m: any, reason: string) {
  console.error(`[SWAP] ⚠️ ${swapId}: USDCx received, payout HELD for a person: ${reason}`);
  await prisma.transaction.update({ where: { id: swapId }, data: { metadata: { ...m, swapStatus: "HELD", heldReason: reason, heldAt: new Date().toISOString() } } });
  const fresh = await prisma.transaction.findUnique({ where: { id: swapId }, select: { userId: true } });
  if (fresh) {
    await sendNotification({
      userId: fresh.userId,
      type: "transaction",
      title: "Swap being finished",
      body: "Your USDCx reached us safely. This swap is taking a little longer and is being finished for you.",
    }).catch(() => {});
  }
}

async function sendRouteUsdc(to: string, amount: number): Promise<string> {
  const wallet = new ethers.Wallet(env.SWAP_EVM_PRIVATE_KEY, new ethers.JsonRpcProvider(env.BASE_RPC_URL));
  const usdc = new ethers.Contract(BASE_USDC_CONTRACT, ["function transfer(address to, uint256 amount) returns (bool)"], wallet);
  const sent = await usdc.transfer(to, ethers.parseUnits(amount.toFixed(6), 6));
  const receipt = await sent.wait(1, 90_000);
  if (!receipt || receipt.status !== 1) throw Object.assign(new Error("Base transfer did not confirm"), { txHash: sent.hash });
  return receipt.hash;
}

/** Pay a routed swap out, once. Claimed first, so the app and the background job cannot both pay. */
async function routeOnward(swapId: string): Promise<void> {
  const tx = await prisma.transaction.findUnique({ where: { id: swapId } });
  if (!tx || tx.status !== "PROCESSING") return;
  const m = meta(tx);
  if (m.route !== ROUTE || m.swapStatus !== "ROUTING") return;

  const paying = { ...m, swapStatus: "PAYING", payingAt: new Date().toISOString() };
  const claimed = await prisma.transaction.updateMany({
    where: { id: swapId, status: "PROCESSING", metadata: { path: ["swapStatus"], equals: "ROUTING" } },
    data: { metadata: paying },
  });
  if (claimed.count !== 1) return;

  const net = Number(m.from.net);
  /**
   * What is known so far, carried into a hold whatever step fails. Above all
   * the payout's hash: a hold that lost it would invite paying by hand a
   * second time for money already sent.
   */
  let state: any = paying;
  try {
    if ((await routeHeadroom()) + net + 1e-9 < net) {
      // Headroom already counts this swap as promised; less than nothing left means short.
      return holdRouted(swapId, state, "Base swap wallet short");
    }

    // Base USDC asked for: pay their own Base wallet, done.
    if (m.to.id === ROUTE_USDC.id) {
      let hash: string;
      try {
        hash = await sendRouteUsdc(m.to.address, net);
      } catch (err: any) {
        return holdRouted(swapId, { ...state, ...(err?.txHash ? { payoutTxHash: err.txHash } : {}) }, `payout failed: ${err?.message}`);
      }
      state = { ...state, payoutTxHash: hash };
      const done = { ...state, swapStatus: "SUCCESS", txHash: hash, completedAt: new Date().toISOString() };
      const { count } = await prisma.transaction.updateMany({
        where: { id: swapId, status: "PROCESSING" },
        data: { status: "COMPLETED", amount: net, metadata: done },
      });
      if (count === 1) await finish(tx.userId, swapId, "COMPLETED", done, net);
      return;
    }

    // Anything else: a fresh quote from USDC on Base to what they chose.
    const r = await requestQuote({
      dry: false,
      swapType: "EXACT_INPUT",
      depositType: "ORIGIN_CHAIN",
      depositMode: "SIMPLE",
      amount: sentUnits("BASE", net, 6),
      originAsset: ROUTE_USDC.assetId,
      destinationAsset: m.to.assetId,
      slippageTolerance: m.slippageBps ?? 100,
      refundTo: m.refundAddress,
      refundType: "ORIGIN_CHAIN",
      recipient: m.to.address,
      recipientType: "DESTINATION_CHAIN",
    });
    const q = r.data?.quote;
    if (!r.ok || !q?.depositAddress) return holdRouted(swapId, state, `no onward quote: ${r.error ?? r.status}`);

    const toDecimals = (await liveSwapAssets()).find((a) => a.id === m.to.id)?.decimals ?? 6;
    // Written before the send, so a stop after it still knows where the money went.
    const quoted = {
      ...state,
      depositAddress: q.depositAddress,
      provider: r.provider,
      quoteCorrelationId: r.data?.correlationId ?? null,
      deadline: q.deadline ?? null,
      to: { ...m.to, expected: fromBaseUnits(q.amountOut, toDecimals), minimum: fromBaseUnits(q.minAmountOut, toDecimals) },
    };
    state = quoted;
    await prisma.transaction.update({ where: { id: swapId }, data: { metadata: quoted } });

    let hash: string;
    try {
      hash = await sendRouteUsdc(q.depositAddress, net);
    } catch (err: any) {
      return holdRouted(swapId, { ...state, ...(err?.txHash ? { payoutTxHash: err.txHash } : {}) }, `onward send failed: ${err?.message}`);
    }
    state = { ...state, payoutTxHash: hash, swapStatus: "PENDING_DEPOSIT" };
    await prisma.transaction.update({ where: { id: swapId }, data: { metadata: state } });
    submitDepositTx(hash, q.depositAddress, undefined, (r.provider ?? "aurora") as SwapProvider).catch(() => {});
  } catch (err: any) {
    // Once the onward payment is out, the swap is only being followed, not held: the provider has it.
    if (state.payoutTxHash && state.depositAddress) {
      console.error(`[SWAP] ${swapId}: paid out (${state.payoutTxHash}) but could not record it: ${err?.message}`);
      return;
    }
    await holdRouted(swapId, state, err?.message || "payout failed");
  }
}
