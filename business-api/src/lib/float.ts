/**
 * The USDC float: where settlements to a business wallet (and, later, a linked
 * Money Moves account) are paid from, on the business's settle chain.
 *
 * Built on the app's treasury sends (backend/src/lib/treasury.ts), with one
 * difference that matters for money: a send is split into before and after
 * broadcast. Anything that fails before - a bad address, a float too low - is
 * "not sent" and nothing moved. Once the transaction is out, its hash is the
 * only handle on it: the caller records it straight away and asks the chain
 * about it, and never sends the same settlement again.
 *
 * The float pays its own fees: a little MOVE on Movement, SOL on Solana, MON on
 * Monad and XLM on Stellar. Arc's fees are paid in USDC itself. On Stellar the
 * float is the Solana key's twin (lib/stellar).
 */
import { Account, Aptos, AptosConfig, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";
import { Connection, Keypair, PublicKey, SendTransactionError, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ethers } from "ethers";
import bs58 from "bs58";
import { env } from "../config/env";
import { StellarNotSent, stellarFloat, stellarFloatBalances, stellarSend, stellarTxStatus } from "./stellar";

export type FloatChain = "MOVEMENT" | "SOLANA" | "ARC" | "MONAD" | "STELLAR";

// USDC on Movement is USDCx - what the app and the float hold and send (the older bridged token is 0x83121c…).
const MOVE_USDC = "0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e";
const SOL_USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const MONAD_USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const ERC20 = ["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"];

/** Nothing left the float: safe to fail, or to try again later. */
export class NotSent extends Error {
  constructor(
    message: string,
    /** True when it's worth trying again by itself (a low float, a busy network) rather than waiting for a person. */
    public retry = false,
  ) {
    super(message);
  }
}

export interface Sent {
  txHash: string;
  /** Resolves once the chain has it final; rejects if it failed on-chain. */
  confirmed: Promise<void>;
}

const need = (v: string | undefined, name: string) => {
  if (!v) throw new NotSent(`${name} isn't set, so this chain can't pay out yet.`);
  return v;
};

// ─── Movement ─────────────────────────────────────────────────────────────

const aptos = () => new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode: need(env.MOVEMENT_RPC_URL, "MOVEMENT_RPC_URL") }));
const moveAccount = () => Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(need(env.FLOAT_MOVEMENT_PRIVATE_KEY, "FLOAT_MOVEMENT_PRIVATE_KEY")) });

async function moveUsdcOf(client: Aptos, address: string): Promise<bigint> {
  const [raw] = await client.view({ payload: { function: "0x1::primary_fungible_store::balance", typeArguments: ["0x1::fungible_asset::Metadata"], functionArguments: [address, MOVE_USDC] } });
  return BigInt(String(raw ?? "0"));
}

async function sendMovement(to: string, micros: bigint): Promise<Sent> {
  const client = aptos();
  const from = moveAccount();
  if ((await moveUsdcOf(client, from.accountAddress.toString())) < micros) throw new NotSent("The Movement float is low on USDC.", true);
  let transaction;
  try {
    transaction = await client.transaction.build.simple({
      sender: from.accountAddress,
      data: { function: "0x1::primary_fungible_store::transfer", typeArguments: ["0x1::fungible_asset::Metadata"], functionArguments: [MOVE_USDC, to, micros] },
    });
  } catch (e) {
    throw new NotSent(`Couldn't build the Movement payout: ${(e as Error).message}`);
  }
  const senderAuthenticator = client.transaction.sign({ signer: from, transaction });
  const submitted = await client.transaction.submit.simple({ transaction, senderAuthenticator });
  return {
    txHash: submitted.hash,
    confirmed: client.waitForTransaction({ transactionHash: submitted.hash }).then((r) => {
      if (!(r as { success?: boolean }).success) throw new Error(`Movement transaction failed: ${(r as { vm_status?: string }).vm_status ?? "unknown"}`);
    }),
  };
}

// ─── Solana ───────────────────────────────────────────────────────────────

const solConnection = () => new Connection(need(env.SOLANA_RPC_URL, "SOLANA_RPC_URL"), { commitment: "confirmed", wsEndpoint: undefined });
const solKeypair = () => Keypair.fromSecretKey(bs58.decode(need(env.FLOAT_SOLANA_PRIVATE_KEY, "FLOAT_SOLANA_PRIVATE_KEY")));

async function solStatus(conn: Connection, sig: string): Promise<"settled" | "failed" | "pending" | "unknown"> {
  const { value } = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
  const s = value?.[0];
  if (!s) return "unknown";
  if (s.err) return "failed";
  return s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" ? "settled" : "pending";
}

async function sendSolana(to: string, micros: bigint): Promise<Sent> {
  const conn = solConnection();
  const from = solKeypair();
  let recipient: PublicKey;
  try {
    recipient = new PublicKey(to);
  } catch {
    throw new NotSent("That isn't a Solana address.");
  }
  const fromAta = getAssociatedTokenAddressSync(SOL_USDC, from.publicKey);
  const toAta = getAssociatedTokenAddressSync(SOL_USDC, recipient);
  const bal = await conn.getTokenAccountBalance(fromAta).catch(() => null);
  if (!bal || BigInt(bal.value.amount) < micros) throw new NotSent("The Solana float is low on USDC.", true);
  const tx = new Transaction().add(
    // The recipient's USDC account, opened if it isn't there yet - paid by the float.
    createAssociatedTokenAccountIdempotentInstruction(from.publicKey, toAta, recipient, SOL_USDC),
    createTransferInstruction(fromAta, toAta, from.publicKey, micros),
  );
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = from.publicKey;
  tx.sign(from);
  let sig: string;
  try {
    sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
  } catch (e) {
    // The node answered and turned it down (its simulation failed, or it refused it): nothing was sent.
    if (e instanceof SendTransactionError) throw new NotSent(`Solana refused the payout: ${(e as Error).message.slice(0, 160)}`);
    // No answer at all: it may have gone. Unclear, so nothing sends it again; its signature is kept for whoever checks.
    throw Object.assign(new Error(`No answer from Solana: ${(e as Error).message.slice(0, 160)}`), { txHash: tx.signature ? bs58.encode(tx.signature) : undefined });
  }
  return {
    txHash: sig,
    confirmed: (async () => {
      for (let i = 0; i < 45; i++) {
        const s = await solStatus(conn, sig);
        if (s === "settled") return;
        if (s === "failed") throw new Error("Solana transaction failed on-chain");
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error("Solana transaction not confirmed in time");
    })(),
  };
}

// ─── Arc and Monad ────────────────────────────────────────────────────────

/** Each chain named up front (Arc 5042, Monad 143), so nothing waits on the network being guessed. */
const evmProvider = (chain: "ARC" | "MONAD") =>
  chain === "ARC"
    ? new ethers.JsonRpcProvider(need(env.ARC_RPC_URL, "ARC_RPC_URL"), 5042, { staticNetwork: true })
    : new ethers.JsonRpcProvider(need(env.MONAD_RPC_URL, "MONAD_RPC_URL"), 143, { staticNetwork: true });
const evmWallet = (chain: "ARC" | "MONAD") => new ethers.Wallet(need(env.FLOAT_EVM_PRIVATE_KEY, "FLOAT_EVM_PRIVATE_KEY"), evmProvider(chain));

async function sendEvm(chain: "ARC" | "MONAD", to: string, micros: bigint): Promise<Sent> {
  if (!ethers.isAddress(to)) throw new NotSent("That isn't an EVM address.");
  const wallet = evmWallet(chain);
  const name = chain === "ARC" ? "Arc" : "Monad";
  // Built, estimated and signed first: a failure up to here sent nothing.
  let signed: string;
  try {
    let request: ethers.TransactionRequest;
    if (chain === "ARC") {
      // Arc's own currency is USDC, at 18 decimals: a plain value send.
      const value = micros * 10n ** 12n;
      const balance = await wallet.provider!.getBalance(wallet.address);
      if (balance < value) throw new NotSent("The Arc float is low on USDC.", true);
      request = { to, value };
    } else {
      const usdc = new ethers.Contract(MONAD_USDC, ERC20, wallet);
      if ((await usdc.balanceOf(wallet.address)) < micros) throw new NotSent("The Monad float is low on USDC.", true);
      request = await usdc.transfer.populateTransaction(to, micros);
    }
    signed = await wallet.signTransaction(await wallet.populateTransaction(request));
  } catch (e) {
    if (e instanceof NotSent) throw e;
    throw new NotSent(`${name} refused the payout: ${(e as Error).message.slice(0, 160)}`, /insufficient funds/i.test(String((e as Error).message)));
  }
  let tx: ethers.TransactionResponse;
  try {
    tx = await wallet.provider!.broadcastTransaction(signed);
  } catch (e) {
    // The node answered and turned it down: nothing was sent.
    if (ethers.isError(e, "INSUFFICIENT_FUNDS") || ethers.isError(e, "NONCE_EXPIRED") || ethers.isError(e, "REPLACEMENT_UNDERPRICED") || ethers.isError(e, "CALL_EXCEPTION")) {
      throw new NotSent(`${name} refused the payout: ${(e as Error).message.slice(0, 160)}`, ethers.isError(e, "INSUFFICIENT_FUNDS"));
    }
    // No clear answer: it may have gone. Unclear, so nothing sends it again; its hash is kept for whoever checks.
    throw Object.assign(new Error(`No clear answer from ${name}: ${(e as Error).message.slice(0, 160)}`), { txHash: ethers.keccak256(signed) });
  }
  return {
    txHash: tx.hash,
    confirmed: tx.wait(1, 120_000).then((r) => {
      if (!r || r.status !== 1) throw new Error(`${chain} transaction failed on-chain`);
    }),
  };
}

// ─── Together ─────────────────────────────────────────────────────────────

// ─── Stellar ──────────────────────────────────────────────────────────────

async function sendStellar(to: string, micros: bigint): Promise<Sent> {
  try {
    // In by the time it answers: Stellar is final once the transaction is in a ledger.
    const { txHash } = await stellarSend("USDC", to, micros);
    return { txHash, confirmed: Promise.resolve() };
  } catch (e) {
    if (e instanceof StellarNotSent) throw new NotSent(e.message, e.retry);
    throw e;
  }
}

// ─── Together ─────────────────────────────────────────────────────────────

/** Pays `micros` (USDC, six decimals) to `to` on `chain`, from the float. */
export function floatSend(chain: FloatChain, to: string, micros: bigint): Promise<Sent> {
  if (micros <= 0n) return Promise.reject(new NotSent("Nothing to send."));
  if (chain === "MOVEMENT") return sendMovement(to, micros);
  if (chain === "SOLANA") return sendSolana(to, micros);
  if (chain === "STELLAR") return sendStellar(to, micros);
  return sendEvm(chain, to, micros);
}

/** What the chain says about a payout we sent, by its hash. */
export async function floatTxStatus(chain: FloatChain, txHash: string): Promise<"settled" | "failed" | "pending" | "unknown"> {
  if (chain === "MOVEMENT") {
    try {
      const t = (await aptos().getTransactionByHash({ transactionHash: txHash })) as { type?: string; success?: boolean };
      if (t.type === "pending_transaction") return "pending";
      return t.success ? "settled" : "failed";
    } catch {
      return "unknown";
    }
  }
  if (chain === "SOLANA") return solStatus(solConnection(), txHash);
  if (chain === "STELLAR") return stellarTxStatus(txHash);
  const r = await evmProvider(chain).getTransactionReceipt(txHash);
  if (!r) return (await evmProvider(chain).getTransaction(txHash)) ? "pending" : "unknown";
  return r.status === 1 ? "settled" : "failed";
}

/** The float's own address on a chain - for topping it up. */
export function floatAddress(chain: FloatChain): string | null {
  try {
    if (chain === "MOVEMENT") return moveAccount().accountAddress.toString();
    if (chain === "SOLANA") return solKeypair().publicKey.toBase58();
    if (chain === "STELLAR") return stellarFloat()?.publicKey() ?? null;
    return new ethers.Wallet(need(env.FLOAT_EVM_PRIVATE_KEY, "FLOAT_EVM_PRIVATE_KEY")).address;
  } catch {
    return null;
  }
}

/** What the float holds on a chain, in USDC micros, and its fee coin - read only. */
export async function floatBalances(chain: FloatChain): Promise<{ usdcMicros: bigint; feeCoin: string; fee: number } | null> {
  const address = floatAddress(chain);
  if (!address) return null;
  if (chain === "MOVEMENT") {
    const client = aptos();
    const move = await client.view({ payload: { function: "0x1::coin::balance", typeArguments: ["0x1::aptos_coin::AptosCoin"], functionArguments: [address] } }).catch(() => ["0"]);
    return { usdcMicros: await moveUsdcOf(client, address), feeCoin: "MOVE", fee: Number(BigInt(String(move[0] ?? "0"))) / 1e8 };
  }
  if (chain === "SOLANA") {
    const conn = solConnection();
    const owner = new PublicKey(address);
    const bal = await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(SOL_USDC, owner)).catch(() => null);
    return { usdcMicros: BigInt(bal?.value.amount ?? "0"), feeCoin: "SOL", fee: (await conn.getBalance(owner)) / 1e9 };
  }
  if (chain === "STELLAR") {
    const b = await stellarFloatBalances();
    return b ? { usdcMicros: b.usdcMicros, feeCoin: "XLM", fee: b.xlm } : null;
  }
  const provider = evmProvider(chain);
  const native = await provider.getBalance(address);
  if (chain === "ARC") return { usdcMicros: native / 10n ** 12n, feeCoin: "USDC", fee: Number(native / 10n ** 12n) / 1e6 };
  const usdc = new ethers.Contract(MONAD_USDC, ERC20, provider);
  return { usdcMicros: BigInt(await usdc.balanceOf(address)), feeCoin: "MON", fee: Number(ethers.formatEther(native)) };
}
