/**
 * Sending USDC out of a business wallet on Arc or Monad: we prepare the exact
 * transaction, the owner's own wallet signs it in the dashboard, and we check
 * the signed one is that transaction - same sender, recipient, amount, nonce,
 * fees - before broadcasting it. Nothing the owner didn't approve can go out,
 * and nothing we didn't prepare can come in.
 *
 * Arc's own currency is USDC (18 decimals), so a send there is a value
 * transfer and its fee comes out of the same USDC. Monad's USDC is an ERC-20;
 * its fee is paid in MON, which the owner never has to hold: like the app, we
 * top the wallet up from the sponsor first.
 */
import { ethers } from "ethers";
import { env } from "../config/env";
import { HttpError } from "./http";
import { log } from "./log";
import { SentUnclear } from "./ed-send";

export type EvmChain = "ARC" | "MONAD";
const CHAIN_ID: Record<EvmChain, number> = { ARC: 5042, MONAD: 143 };
const MONAD_USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const erc20 = new ethers.Interface(["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

export const evmProvider = (chain: EvmChain) => {
  const url = chain === "ARC" ? env.ARC_RPC_URL : env.MONAD_RPC_URL;
  if (!url) throw new HttpError(503, "Sending on this network isn't switched on yet.", "network_off");
  return new ethers.JsonRpcProvider(url, CHAIN_ID[chain], { staticNetwork: true });
};

/** What we prepared, as plain values - stored, sent to the dashboard, and checked against the signature. */
export interface UnsignedEvmTx {
  type: 2;
  chainId: number;
  to: string;
  data: string;
  value: string;
  nonce: number;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

/** Tops `owner` up with MON from the sponsor when it can't cover `cost`. Waits for it to land. */
async function coverMonadFee(provider: ethers.JsonRpcProvider, owner: string, cost: bigint) {
  const have = await provider.getBalance(owner);
  if (have >= cost) return;
  if (!env.EVM_GAS_SPONSOR_PRIVATE_KEY) throw new HttpError(503, "Sending on Monad isn't switched on yet.", "sponsor_off");
  const sponsor = new ethers.Wallet(env.EVM_GAS_SPONSOR_PRIVATE_KEY, provider);
  const top = cost * 2n - have;
  const tx = await sponsor.sendTransaction({ to: owner, value: top });
  log.info("[wallet-send] monad fee top-up", { to: owner, tx: tx.hash });
  const r = await tx.wait(1, 60_000);
  if (!r || r.status !== 1) throw new HttpError(502, "We couldn't prepare this send. Try again in a moment.", "sponsor_failed");
}

export async function prepareEvmSend(chain: EvmChain, from: string, to: string, micros: bigint): Promise<UnsignedEvmTx> {
  if (!ethers.isAddress(to)) throw new HttpError(400, "That isn't a valid address for this network.", "bad_address");
  const provider = evmProvider(chain);
  const fees = await provider.getFeeData();
  const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 0n;
  const nonce = await provider.getTransactionCount(from, "pending");
  let txTo: string, data: string, value: bigint;
  if (chain === "ARC") {
    txTo = ethers.getAddress(to);
    data = "0x";
    value = micros * 10n ** 12n;
  } else {
    txTo = MONAD_USDC;
    data = erc20.encodeFunctionData("transfer", [ethers.getAddress(to), micros]);
    value = 0n;
    const usdc = BigInt(await provider.call({ to: MONAD_USDC, data: erc20.encodeFunctionData("balanceOf", [from]) }));
    if (usdc < micros) throw new HttpError(400, "There isn't that much USDC on Monad in the wallet.", "insufficient_balance");
  }
  const estimate = await provider.estimateGas({ from, to: txTo, data, value }).catch(() => (chain === "ARC" ? 21_000n : 80_000n));
  const gasLimit = (estimate * 12n) / 10n;
  const feeCost = gasLimit * maxFeePerGas;
  if (chain === "ARC") {
    const balance = await provider.getBalance(from);
    if (balance < value + feeCost) throw new HttpError(400, "There isn't enough USDC on Arc in the wallet for this amount and its network fee.", "insufficient_balance");
  } else {
    await coverMonadFee(provider, from, feeCost);
  }
  return {
    type: 2,
    chainId: CHAIN_ID[chain],
    to: txTo,
    data,
    value: value.toString(),
    nonce,
    gasLimit: gasLimit.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
  };
}

/** The signed transaction, checked field by field against what we prepared, then broadcast. Returns its hash. */
export async function broadcastSignedEvm(chain: EvmChain, signed: string, prepared: UnsignedEvmTx, from: string): Promise<string> {
  let tx: ethers.Transaction;
  try {
    tx = ethers.Transaction.from(signed);
  } catch {
    throw new HttpError(400, "That signature couldn't be read. Try sending again.", "bad_signature");
  }
  const same =
    tx.from?.toLowerCase() === from.toLowerCase() &&
    tx.to?.toLowerCase() === prepared.to.toLowerCase() &&
    tx.data.toLowerCase() === prepared.data.toLowerCase() &&
    tx.value === BigInt(prepared.value) &&
    tx.nonce === prepared.nonce &&
    tx.chainId === BigInt(prepared.chainId) &&
    tx.gasLimit === BigInt(prepared.gasLimit) &&
    tx.maxFeePerGas === BigInt(prepared.maxFeePerGas) &&
    tx.maxPriorityFeePerGas === BigInt(prepared.maxPriorityFeePerGas);
  if (!same) throw new HttpError(400, "What was signed isn't the transfer you approved, so it wasn't sent.", "signature_mismatch");
  try {
    return (await evmProvider(chain).broadcastTransaction(signed)).hash;
  } catch (e) {
    // The node answered and turned it down: nothing was sent.
    if (ethers.isError(e, "INSUFFICIENT_FUNDS") || ethers.isError(e, "NONCE_EXPIRED") || ethers.isError(e, "REPLACEMENT_UNDERPRICED") || ethers.isError(e, "CALL_EXCEPTION")) throw e;
    // No clear answer: it may have gone. Its hash is known, so it's followed on the chain rather than sent again.
    throw new SentUnclear(`No clear answer from the network: ${(e as Error).message}`, tx.hash!);
  }
}

export async function evmTxStatus(chain: EvmChain, hash: string): Promise<"settled" | "failed" | "pending" | "unknown"> {
  const provider = evmProvider(chain);
  const r = await provider.getTransactionReceipt(hash);
  if (!r) return (await provider.getTransaction(hash)) ? "pending" : "unknown";
  return r.status === 1 ? "settled" : "failed";
}
