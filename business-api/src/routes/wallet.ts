/**
 * The business wallet: the owner's own, created once the business is verified.
 *
 * The owner signs in to the business's Dynamic environment in the dashboard,
 * with the same email they use here, and the wallet is theirs - we keep only
 * its addresses. They set a transfer PIN as they create it; moving money out
 * takes the PIN as well as their signature. A forgotten PIN is reset with a
 * code sent to the owner's email. Only the owner can move it. Admins can see
 * it, its balances and its history; the rest of the team can't.
 */
import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import bs58 from "bs58";
import type { BusinessWallet, Refund, WalletSend } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { limited } from "../lib/limits";
import { checkCode, CODE_ERRORS, issueCode } from "../lib/codes";
import { checkDynamicToken } from "../lib/dynamic";
import { movementAddressFromSolana } from "../lib/movement-address";
import { walletHoldings } from "../lib/chain-balances";
import { walletDeposits } from "../lib/wallet-deposits";
import { floatAddress } from "../lib/float";
import { linkAddress } from "../lib/app-links";
import { StellarNotSent, prepareStellarOpening, stellarFromSolana, stellarOpenForUsdc, submitStellarOpening } from "../lib/stellar";
import { requireMember } from "../middleware/auth";
import { env, isDev } from "../config/env";
import { broadcastSignedEvm, prepareEvmSend, type UnsignedEvmTx } from "../lib/evm-send";
import { SentUnclear, buildEdSend, edUsdcOf, isEdChain, submitEdSend, validEdAddress } from "../lib/ed-send";
import { ngnPerUsd } from "../lib/rates";
import { newWalletSendRef } from "../lib/money";
import { payoutsOn, platform } from "../lib/platform";
import { UNCLEAR_SEND, onConfirmed } from "../services/wallet-sends";
import { log } from "../lib/log";
import { esc, fine, heading, quote, rows, sendEmail, shell, supportLine } from "../lib/email";

const router = Router({ mergeParams: true });
const careful = limited(10, 15 * 60_000);
/** PIN tries have room past the lock (five wrong ones), so the lock - not the rate limit - is what a guesser meets. */
const pinTries = limited(isDev ? 200 : 30, 15 * 60_000);

const LOCK_AFTER = 5;
const LOCK_MINUTES = 30;

/** Six digits, and not one anyone would guess first. */
const pinSchema = z
  .string()
  .regex(/^\d{6}$/, "Your PIN is 6 digits.")
  .refine((p) => !/^(\d)\1{5}$/.test(p) && !"0123456789".includes(p) && !"9876543210".includes(p), "Pick a PIN that's harder to guess than that.");

export const walletShape = (w: BusinessWallet | null) =>
  w && {
    email: w.email,
    evmAddress: w.evmAddress,
    solanaAddress: w.solanaAddress,
    movementAddress: w.movementAddress,
    /** Stellar: the Solana key's twin - open for USDC only once the owner opens it on the wallet page. */
    stellarAddress: w.solanaAddress ? stellarFromSolana(w.solanaAddress) : null,
    pinSet: !!w.pinHash,
    locked: !!w.pinLockedUntil && w.pinLockedUntil > new Date(),
    createdAt: w.createdAt,
  };

/** Who can see the wallet: the owner, and admins, who can't send from it. */
const VIEWERS = ["OWNER", "ADMIN"] as const;

const walletOf = (businessId: string) => prisma.businessWallet.findUnique({ where: { businessId } });

router.get("/", requireMember(), async (req, res) => {
  const businessId = req.member!.businessId;
  const [wallet, business] = await Promise.all([walletOf(businessId), prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { status: true } })]);
  const owner = req.member!.role === "OWNER";
  const sees = owner || req.member!.role === "ADMIN";
  res.json({
    // Admins see the wallet, its balances and history, and can't move it. The rest of the team only learns that it exists.
    wallet: sees ? walletShape(wallet) : null,
    exists: !!wallet,
    // What the page needs to say next: verify first, ask the owner, or create it.
    canCreate: !wallet && business.status === "VERIFIED" && req.member!.role === "OWNER",
    verified: business.status === "VERIFIED",
    isOwner: req.member!.role === "OWNER",
  });
});

/** What the wallet holds, read from each chain. */
router.get("/balances", requireMember(...VIEWERS), limited(60), async (req, res) => {
  const w = await walletOf(req.member!.businessId);
  // With today's rate, so a bank payout can be typed in naira and shown in USDC.
  const [balances, rate] = await Promise.all([w ? walletHoldings(w) : [], ngnPerUsd().catch(() => null)]);
  res.json({ balances, ngnPerUsd: rate });
});

// ─── Stellar ──────────────────────────────────────────────────────────────

/** The wallet on Stellar: its address (the Solana key's twin) and whether it can hold USDC yet. */
router.get("/stellar", requireMember(...VIEWERS), limited(60), async (req, res) => {
  const w = await walletOf(req.member!.businessId);
  const address = w?.solanaAddress ? stellarFromSolana(w.solanaAddress) : null;
  res.json({ stellar: address ? { address, open: await stellarOpenForUsdc(address).catch(() => false) } : null });
});

/** Opening it for USDC: the transaction's hash for the owner's wallet to sign. We sponsor the reserve and the fee. */
router.post("/stellar/prepare", requireMember("OWNER"), careful, async (req, res) => {
  const w = await ownWallet(req.member!.businessId, req.auth!.userId);
  const address = w.solanaAddress ? stellarFromSolana(w.solanaAddress) : null;
  if (!address) throw new HttpError(409, "Your wallet has no Solana key, which Stellar uses. Contact support.", "no_stellar_key");
  try {
    const opening = await prepareStellarOpening(address);
    res.json(opening ? { hash: opening.hash } : { open: true });
  } catch (e) {
    if (e instanceof StellarNotSent) throw new HttpError(503, e.message, "stellar_unavailable");
    throw e;
  }
});

router.post("/stellar/submit", requireMember("OWNER"), careful, async (req, res) => {
  const b = body(z.object({ signature: z.string().min(40).max(200), encoding: z.enum(["hex", "base64", "base58"]).optional() }), req);
  const w = await ownWallet(req.member!.businessId, req.auth!.userId);
  const address = w.solanaAddress ? stellarFromSolana(w.solanaAddress) : null;
  if (!address) throw new HttpError(409, "Your wallet has no Solana key, which Stellar uses. Contact support.", "no_stellar_key");
  let sig: Buffer;
  try {
    sig = b.encoding === "base58" ? Buffer.from(bs58.decode(b.signature)) : /^[0-9a-fA-F]{128}$/.test(b.signature) ? Buffer.from(b.signature, "hex") : Buffer.from(b.signature, "base64");
  } catch {
    throw new HttpError(400, "That signature couldn't be read. Try again.", "bad_signature");
  }
  try {
    const tx = await submitStellarOpening(address, sig);
    await audit(req, "wallet_stellar_opened", { businessId: w.businessId, detail: { address, tx } });
    res.json({ open: true, tx });
  } catch (e) {
    if (e instanceof StellarNotSent) throw new HttpError(400, e.message, "stellar_refused");
    throw e;
  }
});

/**
 * Money into the wallet from anywhere, read from the chains - less what our own
 * settlements sent, which the activity already shows as settlements.
 */
router.get("/deposits", requireMember(...VIEWERS), limited(30), async (req, res) => {
  const w = await walletOf(req.member!.businessId);
  if (!w) {
    res.json({ deposits: [] });
    return;
  }
  const [list, settled] = await Promise.all([
    walletDeposits(w, req.query.fresh === "1"),
    prisma.settlement.findMany({ where: { businessId: w.businessId, txHash: { not: null } }, select: { txHash: true } }),
  ]);
  // A settlement is shown as a settlement, never again as a deposit: not its transaction, and nothing from our float.
  const ours = new Set(settled.map((x) => x.txHash!.toLowerCase()));
  const floats = new Set((["MOVEMENT", "SOLANA", "ARC", "MONAD", "STELLAR"] as const).map((c) => floatAddress(c)?.toLowerCase()).filter(Boolean) as string[]);
  res.json({ deposits: list.filter((d) => !ours.has(d.tx.toLowerCase()) && !(d.from && floats.has(d.from.toLowerCase()))) });
});

/** Created with the owner's Dynamic sign-in and the PIN they chose. */
router.post("/", requireMember("OWNER"), careful, async (req, res) => {
  const businessId = req.member!.businessId;
  const b = body(
    z.object({
      token: z.string().min(20),
      pin: pinSchema,
      // Which of the owner's wallets this business takes. Left out, the first one no other business uses.
      evmAddress: z.string().min(20).max(80).optional(),
      solanaAddress: z.string().min(20).max(80).optional(),
    }),
    req,
  );
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { status: true } });
  if (business.status !== "VERIFIED") throw new HttpError(403, "Your business wallet opens once your business is verified.", "not_verified");
  if (await walletOf(businessId)) throw new HttpError(409, "This business already has its wallet.", "wallet_exists");

  const signIn = await checkDynamicToken(b.token);
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: { email: true } });
  if (signIn.email !== owner.email.toLowerCase()) {
    throw new HttpError(403, `Sign in to the wallet with ${owner.email}, the email you use here.`, "wallet_email");
  }
  if (!signIn.evmAddress && !signIn.solanaAddress) throw new HttpError(409, "Your wallet is still being set up. Wait a moment and try again.", "wallet_pending");

  /**
   * One wallet per business, never shared.
   *
   * The wallet is the owner's own, and one email signs in to it - so an owner
   * with two businesses used to get the same addresses for both, and the two
   * businesses' money sat in one wallet. Each business now takes a wallet no
   * other business holds: the one the dashboard names, or else the first free
   * one the sign-in proves. With none free, the dashboard makes the owner a
   * new wallet and asks again.
   */
  const sameEvm = (a: string, b2: string) => a.toLowerCase() === b2.toLowerCase();
  const taken = await prisma.businessWallet.findMany({
    where: { OR: [{ evmAddress: { in: signIn.evmAddresses, mode: "insensitive" } }, { solanaAddress: { in: signIn.solanaAddresses } }] },
    select: { evmAddress: true, solanaAddress: true, business: { select: { name: true } } },
  });
  const evmTaken = (a: string) => taken.some((t) => t.evmAddress && sameEvm(t.evmAddress, a));
  const solTaken = (a: string) => taken.some((t) => t.solanaAddress === a);
  const takenBy = (pred: (t: (typeof taken)[number]) => boolean) => taken.find(pred)?.business?.name ?? "another business";

  let evmAddress: string | null;
  let solanaAddress: string | null;
  if (b.evmAddress || b.solanaAddress) {
    // Named by the dashboard: it has to be a wallet this sign-in proves, and free.
    if (b.evmAddress && !signIn.evmAddresses.some((a) => sameEvm(a, b.evmAddress!))) {
      throw new HttpError(403, "That wallet isn't one of yours. Sign in to your wallet again and retry.", "wallet_not_yours");
    }
    if (b.solanaAddress && !signIn.solanaAddresses.includes(b.solanaAddress)) {
      throw new HttpError(403, "That wallet isn't one of yours. Sign in to your wallet again and retry.", "wallet_not_yours");
    }
    if (b.evmAddress && evmTaken(b.evmAddress)) {
      throw new HttpError(409, `That wallet already belongs to ${takenBy((t) => !!t.evmAddress && sameEvm(t.evmAddress, b.evmAddress!))}.`, "wallet_in_use");
    }
    if (b.solanaAddress && solTaken(b.solanaAddress)) {
      throw new HttpError(409, `That wallet already belongs to ${takenBy((t) => t.solanaAddress === b.solanaAddress)}.`, "wallet_in_use");
    }
    evmAddress = b.evmAddress ?? null;
    solanaAddress = b.solanaAddress ?? null;
  } else {
    evmAddress = signIn.evmAddresses.find((a) => !evmTaken(a)) ?? null;
    solanaAddress = signIn.solanaAddresses.find((a) => !solTaken(a)) ?? null;
  }
  // Both halves of one wallet, or none: a business needs its own EVM and Solana addresses.
  if (!evmAddress || !solanaAddress) {
    throw new HttpError(
      409,
      `Your wallet already belongs to ${taken[0]?.business?.name ?? "another business"}. Each business gets its own wallet, so a new one will be made for this business.`,
      "wallet_needs_new",
    );
  }

  const wallet = await prisma.businessWallet.create({
    data: {
      businessId,
      ownerUserId: req.auth!.userId,
      dynamicUserId: signIn.userId,
      email: signIn.email,
      evmAddress,
      solanaAddress,
      movementAddress: movementAddressFromSolana(solanaAddress),
      pinHash: await bcrypt.hash(b.pin, 12),
      pinSetAt: new Date(),
    },
  });
  await audit(req, "wallet_created", { businessId, detail: { evm: wallet.evmAddress, solana: wallet.solanaAddress, movement: wallet.movementAddress } });
  res.status(201).json({ wallet: walletShape(wallet) });
});

async function ownWallet(businessId: string, userId: string) {
  const w = await walletOf(businessId);
  if (!w) throw new HttpError(404, "Create your business wallet first.", "wallet_not_created");
  if (w.ownerUserId !== userId) throw new HttpError(403, "Only the owner who created the wallet can do that.", "wallet_owner_only");
  return w;
}

/**
 * Checks a PIN, counting the wrong ones: five in a row locks the wallet's
 * sending for half an hour. Used before anything leaves the wallet.
 */
export async function checkPin(w: BusinessWallet, pin: string): Promise<void> {
  if (w.pinLockedUntil && w.pinLockedUntil > new Date()) {
    throw new HttpError(423, "Too many wrong PINs. Sending is paused for a while, or reset your PIN by email.", "pin_locked");
  }
  if (!w.pinHash || !(await bcrypt.compare(pin, w.pinHash))) {
    const failures = w.pinFailures + 1;
    const lock = failures >= LOCK_AFTER;
    await prisma.businessWallet.update({
      where: { id: w.id },
      data: { pinFailures: lock ? 0 : failures, pinLockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : undefined },
    });
    throw new HttpError(401, lock ? "Too many wrong PINs. Sending is paused for 30 minutes, or reset your PIN by email." : `That PIN isn't right. ${LOCK_AFTER - failures} ${LOCK_AFTER - failures === 1 ? "try" : "tries"} left.`, lock ? "pin_locked" : "wrong_pin");
  }
  if (w.pinFailures) await prisma.businessWallet.update({ where: { id: w.id }, data: { pinFailures: 0 } });
}

router.post("/pin/check", requireMember("OWNER"), pinTries, async (req, res) => {
  const b = body(z.object({ pin: z.string() }), req);
  await checkPin(await ownWallet(req.member!.businessId, req.auth!.userId), b.pin);
  res.json({ ok: true });
});

/**
 * Before the owner's wallet shows its keys: the transfer PIN, checked and
 * counted like any send (five wrong ones lock the wallet), then recorded, and
 * the owner emailed - so an export nobody meant to make is noticed. The keys
 * themselves never pass through us: the wallet shows them in the owner's own
 * browser.
 */
router.post("/export", requireMember("OWNER"), pinTries, async (req, res) => {
  const b = body(z.object({ pin: z.string(), which: z.enum(["evm", "solana"]) }), req);
  const w = await ownWallet(req.member!.businessId, req.auth!.userId);
  await checkPin(w, b.pin);
  const what = b.which === "evm" ? "EVM networks (Base, BNB Chain, Arc, Monad and the rest)" : "Solana, Movement and Stellar";
  await audit(req, "wallet_exported", { businessId: w.businessId, detail: { which: b.which, address: b.which === "evm" ? w.evmAddress : w.solanaAddress } });
  const business = await prisma.business.findUnique({ where: { id: w.businessId }, select: { name: true } });
  const when = new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
  void sendEmail(w.email, `Your business wallet's keys were opened`, `The private key for ${business?.name ?? "your business"}'s wallet (${what}) was just exported from the dashboard, on ${when}, with your transfer PIN.

If this was you, keep the key offline and never share it. If it wasn't, move the money out of the wallet now and contact support@usemoneymoves.xyz.`, {
    html: shell({
      label: "Security",
      preheader: "Your business wallet's private key was exported.",
      body: `${heading("Your wallet's keys were opened", `The private key for ${esc(business?.name ?? "your business")}'s wallet was just exported from the dashboard, with your transfer PIN.`)}
        ${rows([
          { k: "Wallet", v: what },
          { k: "When", v: when },
        ])}
        ${quote("If this wasn't you, move the money out of the wallet now and write to support@usemoneymoves.xyz.", "warn")}
        ${fine(`If it was you, keep the key offline and never share it. Anyone who has it can move everything in the wallet. ${supportLine()}`)}`,
    }),
  }).catch(() => false);
  res.json({ ok: true });
});

router.post("/pin/change", requireMember("OWNER"), pinTries, async (req, res) => {
  const businessId = req.member!.businessId;
  const b = body(z.object({ currentPin: z.string(), newPin: pinSchema }), req);
  const w = await ownWallet(businessId, req.auth!.userId);
  await checkPin(w, b.currentPin);
  if (b.currentPin === b.newPin) throw new HttpError(400, "Pick a PIN different from the one you have.", "same_pin");
  await prisma.businessWallet.update({ where: { id: w.id }, data: { pinHash: await bcrypt.hash(b.newPin, 12), pinSetAt: new Date(), pinFailures: 0, pinLockedUntil: null } });
  await audit(req, "wallet_pin_changed", { businessId });
  res.json({ ok: true });
});

/** Forgot it: a code to the owner's email, then a new PIN. Also lifts a lock. */
router.post("/pin/reset", requireMember("OWNER"), careful, async (req, res) => {
  await ownWallet(req.member!.businessId, req.auth!.userId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: { id: true, email: true } });
  res.json({ challenge: await issueCode(user, "RESET_WALLET_PIN"), email: user.email });
});

router.post("/pin/reset/finish", requireMember("OWNER"), careful, async (req, res) => {
  const businessId = req.member!.businessId;
  const b = body(z.object({ challenge: z.string(), code: z.string().regex(/^\d{6}$/, "The code is 6 digits."), newPin: pinSchema }), req);
  const w = await ownWallet(businessId, req.auth!.userId);
  const check = await checkCode(b.challenge, b.code, "RESET_WALLET_PIN");
  if (!check.ok) throw new HttpError(400, CODE_ERRORS[check.reason], `code_${check.reason}`);
  if (check.userId !== req.auth!.userId) throw new HttpError(403, "That code was sent to someone else.", "code_mismatch");
  await prisma.businessWallet.update({ where: { id: w.id }, data: { pinHash: await bcrypt.hash(b.newPin, 12), pinSetAt: new Date(), pinFailures: 0, pinLockedUntil: null } });
  await audit(req, "wallet_pin_reset", { businessId });
  res.json({ ok: true });
});

// ─── Sending out ──────────────────────────────────────────────────────────

/** Where a send goes, as the business sees it. */
export const sendShape = (x: WalletSend) => ({
  id: x.id,
  ref: x.ref,
  kind: x.kind,
  // A bank send in review is "on its way" to the business, like any other.
  status: x.status === "CONFIRMED" && x.kind === "BANK" ? "PAYING" : x.status,
  chain: x.chain,
  toAddress: x.kind === "ADDRESS" ? x.toAddress : null,
  /** To a Money Moves account: its @username. Funding a refund: "Refund MMBR-…". */
  label: x.kind === "ADDRESS" ? x.accountName : null,
  refundId: x.refundId,
  amountUsdc: Number(x.amountMicros) / 1e6,
  bank: x.kind === "BANK" ? { name: x.bankName, account: x.accountNumber, accountName: x.accountName } : null,
  ngnPerUsd: x.ngnPerUsd,
  feeNgn: x.feeKobo != null ? x.feeKobo / 100 : null,
  payoutNgn: x.payoutKobo != null ? x.payoutKobo / 100 : null,
  txHash: x.txHash,
  failureReason: x.failureReason,
  createdAt: x.createdAt,
});

const SEND_CHAINS = ["ARC", "MONAD", "MOVEMENT", "SOLANA"] as const;

/** Maintenance on Services: nothing leaves a business wallet - not prepared, not built, not sent. Read fresh, not from the cache. */
async function notInMaintenance() {
  const row = await prisma.setting.findUnique({ where: { key: "platform" } });
  if ((row?.value as { maintenance?: boolean } | null)?.maintenance) {
    throw new HttpError(503, "Sending from your wallet is paused for a short while for maintenance. Your money is safe in your wallet. Try again soon.", "maintenance");
  }
}
/** The wallet's own address on a chain it can send from. */
const fromAddressOn = (w: BusinessWallet, chain: (typeof SEND_CHAINS)[number]) => (chain === "MOVEMENT" ? w.movementAddress : chain === "SOLANA" ? w.solanaAddress : w.evmAddress);
/** Our treasury on a chain: where a bank payout's USDC goes before the naira is paid. */
const treasuryOn = (chain: (typeof SEND_CHAINS)[number]) => (chain === "MOVEMENT" ? env.TREASURY_MOVEMENT_ADDRESS : chain === "SOLANA" ? env.TREASURY_SOLANA_ADDRESS : env.TREASURY_EVM_ADDRESS);

router.get("/sends", requireMember(...VIEWERS), async (req, res) => {
  const list = await prisma.walletSend.findMany({ where: { businessId: req.member!.businessId, status: { not: "EXPIRED" } }, orderBy: { createdAt: "desc" }, take: 50 });
  res.json({ sends: list.map(sendShape) });
});

/**
 * Step one: the owner's PIN, where it goes and how much. We check it all and
 * prepare the exact transaction for their wallet to sign.
 */
router.post("/send/prepare", requireMember("OWNER"), pinTries, async (req, res) => {
  await notInMaintenance();
  const businessId = req.member!.businessId;
  const b = body(
    z.object({
      pin: z.string(),
      chain: z.enum(SEND_CHAINS),
      amountUsdc: z.number().positive().max(1_000_000),
      to: z.union([z.object({ address: z.string().trim().min(10).max(100) }), z.object({ bankAccountId: z.string().min(1) }), z.object({ moneyMovesId: z.string().min(1) }), z.object({ refundId: z.string().min(1) })]),
    }),
    req,
  );
  const w = await ownWallet(businessId, req.auth!.userId);
  await checkPin(w, b.pin);
  const fromAddress = fromAddressOn(w, b.chain);
  if (!fromAddress || (isEdChain(b.chain) && !w.solanaAddress)) throw new HttpError(409, "This wallet has no address on that network.", "no_address");
  let micros = BigInt(Math.round(b.amountUsdc * 1e6));
  if (micros < 10_000n) throw new HttpError(400, "Send at least 0.01 USDC.", "too_small");

  let bank: { id: string; bankCode: string; bankName: string; accountNumber: string; accountName: string } | null = null;
  let quote: { rate: number; feeKobo: number; payoutKobo: number } | null = null;
  let toAddress: string;
  let mmLabel: string | null = null;
  let refund: Refund | null = null;
  if ("refundId" in b.to) {
    // Funding a live refund: exactly what the business sends, to our treasury. The refund moves on once the chain has it.
    refund = await prisma.refund.findFirst({ where: { id: b.to.refundId, businessId, mode: "LIVE", funding: "WALLET", status: "AWAITING_FUNDS" } });
    if (!refund) throw new HttpError(400, "That refund isn't waiting for your wallet.", "bad_refund");
    const treasury = treasuryOn(b.chain);
    if (!treasury) throw new HttpError(503, "Refunds from the wallet aren't switched on on that network yet. Try another.", "treasury_off");
    micros = BigInt(refund.fundCents) * 10_000n;
    toAddress = treasury;
    mmLabel = `Refund ${refund.ref}`;
  } else if ("bankAccountId" in b.to) {
    if (!(await payoutsOn())) throw new HttpError(503, "Bank payouts are paused for a short while. Try again soon.", "payouts_off");
    const acct = await prisma.bankAccount.findFirst({ where: { id: b.to.bankAccountId, businessId, removedAt: null, nameMatches: true } });
    if (!acct) throw new HttpError(400, "Pick a checked bank account from Payout places.", "bad_bank");
    const treasury = treasuryOn(b.chain);
    if (!treasury) throw new HttpError(503, "Bank payouts from the wallet aren't switched on on that network yet. Try another.", "treasury_off");
    const rate = await ngnPerUsd();
    const feeKobo = Math.round((await platform()).fees.payoutNgn * 100);
    const payoutKobo = Math.floor((Number(micros) / 1e6) * rate * 100) - feeKobo;
    if (payoutKobo < 10_000) throw new HttpError(400, "That's too little to send to a bank. It has to be at least ₦100 after the fee.", "too_small");
    bank = { id: acct.id, bankCode: acct.bankCode, bankName: acct.bankName, accountNumber: acct.accountNumber, accountName: acct.accountName };
    quote = { rate, feeKobo, payoutKobo };
    toAddress = treasury;
  } else if ("moneyMovesId" in b.to) {
    // A linked Money Moves account: its address on this network, asked of the app now.
    const link = await prisma.moneyMovesLink.findFirst({ where: { id: b.to.moneyMovesId, businessId, status: "LINKED" } });
    if (!link) throw new HttpError(400, "Pick a linked Money Moves account from Payout places.", "bad_account");
    let address: string | null;
    try {
      address = await linkAddress(link.appLinkId, b.chain);
    } catch {
      throw new HttpError(502, "Money Moves didn't answer just now. Try again in a moment.", "app_error");
    }
    if (!address) throw new HttpError(400, `@${link.username} has no address on ${b.chain.charAt(0) + b.chain.slice(1).toLowerCase()} yet. Pick another network.`, "no_address");
    toAddress = address;
    mmLabel = `@${link.username}`;
  } else {
    toAddress = b.to.address;
  }

  // EVM: the exact transaction now, for the wallet to sign. Movement and Solana: checked now, built when the owner approves.
  let tx: UnsignedEvmTx | null = null;
  if (isEdChain(b.chain)) {
    if (!validEdAddress(b.chain, toAddress)) throw new HttpError(400, "That isn't a valid address for this network.", "bad_address");
    if ((await edUsdcOf(b.chain, fromAddress)) < micros) throw new HttpError(400, `There isn't that much USDC on ${b.chain === "MOVEMENT" ? "Movement" : "Solana"} in the wallet.`, "insufficient_balance");
  } else {
    tx = await prepareEvmSend(b.chain, fromAddress, toAddress, micros);
  }
  const data = {
      ref: newWalletSendRef(),
      walletId: w.id,
      businessId,
      kind: (bank ? "BANK" : "ADDRESS") as "BANK" | "ADDRESS",
      chain: b.chain,
      toAddress,
      amountMicros: micros,
      bankAccountId: bank?.id,
      bankCode: bank?.bankCode,
      bankName: bank?.bankName,
      accountNumber: bank?.accountNumber,
      accountName: bank?.accountName ?? mmLabel,
      ngnPerUsd: quote?.rate,
      feeKobo: quote?.feeKobo,
      payoutKobo: quote?.payoutKobo,
      unsignedTx: (tx ?? { builtOnApproval: true, chain: b.chain }) as unknown as object,
      expiresAt: new Date(Date.now() + 5 * 60_000),
      createdBy: req.auth!.userId,
  };
  const forRefund = refund;
  // One send per refund at a time: the refund's row is locked while we check nothing else is on its way for it.
  const send = forRefund
    ? await prisma.$transaction(async (t) => {
        await t.$queryRaw`SELECT id FROM refunds WHERE id = ${forRefund.id} FOR UPDATE`;
        if (!(await t.refund.count({ where: { id: forRefund.id, status: "AWAITING_FUNDS" } }))) throw new HttpError(409, "This refund isn't waiting for money any more.", "not_waiting");
        const going = await t.walletSend.count({ where: { refundId: forRefund.id, OR: [{ status: { in: ["SENT", "CONFIRMED"] } }, { status: "PREPARED", expiresAt: { gt: new Date() } }] } });
        if (going) throw new HttpError(409, "A send for this refund is already on its way.", "already_sending");
        return t.walletSend.create({ data: { ...data, refundId: forRefund.id } });
      })
    : await prisma.walletSend.create({ data });
  res.status(201).json({ send: sendShape(send), tx });
});

/** Movement and Solana: the transaction, built as the owner approves - its bytes for their wallet to sign. */
router.post("/send/:sendId/build", requireMember("OWNER"), limited(30), async (req, res) => {
  await notInMaintenance();
  const businessId = req.member!.businessId;
  const w = await ownWallet(businessId, req.auth!.userId);
  const send = await prisma.walletSend.findFirst({ where: { id: String(req.params.sendId), businessId } });
  if (!send) throw new HttpError(404, "That send isn't here.", "not_found");
  if (send.status !== "PREPARED") throw new HttpError(409, "This send has already gone, or was cancelled.", "not_prepared");
  if (send.expiresAt < new Date()) throw new HttpError(410, "This send took too long to approve. Start it again.", "expired");
  if (!isEdChain(send.chain)) throw new HttpError(400, "This send is signed as a whole transaction.", "not_ed25519");
  const owner = fromAddressOn(w, send.chain);
  if (!owner || !w.solanaAddress) throw new HttpError(409, "This wallet has no address on that network.", "no_address");
  res.json({ message: await buildEdSend(send.id, send.chain, owner, w.solanaAddress, send.toAddress, send.amountMicros) });
});

/** Step two: the owner's wallet signed it. We check it's the transaction we prepared, and send it. */
router.post("/send/:sendId/submit", requireMember("OWNER"), careful, async (req, res) => {
  await notInMaintenance();
  const businessId = req.member!.businessId;
  const b = body(
    z.object({
      signedTx: z.string().regex(/^0x[0-9a-fA-F]+$/, "That isn't a signed transaction.").optional(),
      signature: z.string().min(40).max(200).optional(),
      encoding: z.enum(["hex", "base58"]).optional(),
    }),
    req,
  );
  const w = await ownWallet(businessId, req.auth!.userId);
  const send = await prisma.walletSend.findFirst({ where: { id: String(req.params.sendId), businessId } });
  if (!send) throw new HttpError(404, "That send isn't here.", "not_found");
  if (send.status !== "PREPARED") throw new HttpError(409, "This send has already gone, or was cancelled.", "not_prepared");
  if (send.expiresAt < new Date()) throw new HttpError(410, "This send took too long to approve. Start it again.", "expired");
  if (send.refundId && !(await prisma.refund.count({ where: { id: send.refundId, status: "AWAITING_FUNDS" } }))) {
    throw new HttpError(409, "This refund isn't waiting for money any more, so nothing was sent.", "not_waiting");
  }
  let hash: string;
  let unclearSend = false;
  try {
    if (isEdChain(send.chain)) {
      if (!b.signature) throw new HttpError(400, "Your wallet's signature is missing. Approve it again.", "no_signature");
      let sig: Buffer;
      try {
        sig = b.encoding === "hex" ? Buffer.from(b.signature, "hex") : Buffer.from(bs58.decode(b.signature));
      } catch {
        throw new HttpError(400, "That signature couldn't be read. Approve it again.", "bad_signature");
      }
      hash = await submitEdSend(send.id, sig);
    } else {
      if (!b.signedTx) throw new HttpError(400, "That isn't a signed transaction.", "no_signature");
      hash = await broadcastSignedEvm(send.chain as "ARC" | "MONAD", b.signedTx, send.unsignedTx as unknown as UnsignedEvmTx, w.evmAddress!);
    }
  } catch (e) {
    // It may have gone with the answer lost: recorded as sent, and the worker asks the chain. A bank payout follows only once the chain says it landed.
    if (!(e instanceof SentUnclear)) throw e;
    log.warn("[wallet-send] broadcast answer lost, following it on the chain", { ref: send.ref, tx: e.txHash });
    hash = e.txHash;
    unclearSend = true;
  }
  const moved = await prisma.walletSend.updateMany({ where: { id: send.id, status: "PREPARED" }, data: { status: "SENT", txHash: hash, ...(unclearSend ? { failureReason: UNCLEAR_SEND } : {}) } });
  if (!moved.count) throw new HttpError(409, "This send has already gone.", "not_prepared");
  await audit(req, "wallet_send", { businessId, detail: { ref: send.ref, kind: send.kind, chain: send.chain, amountUsdc: Number(send.amountMicros) / 1e6, tx: hash } });
  // Confirmation usually takes seconds; the worker picks it up if this round misses it.
  if (!isEdChain(send.chain)) void (async () => {
    try {
      const { evmProvider } = await import("../lib/evm-send");
      const r = await evmProvider(send.chain as "ARC" | "MONAD").waitForTransaction(hash, 1, 60_000);
      if (r?.status === 1) await onConfirmed({ ...send, status: "SENT", txHash: hash });
    } catch (e) {
      log.warn("[wallet-send] quick confirm missed. The worker follows it", { ref: send.ref, reason: e instanceof Error ? e.message : String(e) });
    }
  })();
  res.json({ send: sendShape({ ...send, status: "SENT", txHash: hash }) });
});

export default router;
