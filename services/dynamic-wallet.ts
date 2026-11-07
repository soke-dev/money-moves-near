/**
 * dynamic-wallet.ts — Dynamic.xyz embedded-wallet operations.
 *
 * Dynamic never exposes the raw key, so this is the ONLY place that talks to the
 * Dynamic client for wallet actions. wallet-core delegates its Movement/Solana
 * signing here when the user's wallet is a Dynamic embedded wallet.
 *
 * Validated on-device (see memory dynamic-wallet-decision):
 *   - EVM (secp256k1) + Solana (Ed25519) embedded wallets from createWallet.
 *   - Movement rides on the SAME Ed25519 key as Solana (Aptos single-key auth):
 *       movementAddress = sha3_256(solPubkey ‖ 0x00)
 *   - wallets.signMessage({ wallet: solWallet, message: <hex> }) signs the RAW
 *     hex-decoded bytes and returns { signedMessage } as a BASE58 64-byte sig.
 */
import { dynamicClient, setDynamicWebViewVisible } from "@/config/dynamic";
import { endSession, SessionEndedError } from "./session";

// ─── byte helpers ───────────────────────────────────────────
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58Decode(str: string): Uint8Array {
  const bytes = [0];
  for (const ch of str) {
    const val = B58.indexOf(ch);
    if (val < 0) throw new Error("invalid base58");
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of str) {
    if (ch === "1") bytes.push(0);
    else break;
  }
  return new Uint8Array(bytes.reverse());
}
function movementAddrFromPubkey(pub: Uint8Array): string {
  const { sha3_256 } = require("@noble/hashes/sha3.js");
  const payload = new Uint8Array(pub.length + 1);
  payload.set(pub);
  payload[pub.length] = 0x00; // single-key auth scheme
  return "0x" + bytesToHex(sha3_256(payload));
}

// ─── wallet pickers ─────────────────────────────────────────
function userWallets(): any[] {
  return (dynamicClient.wallets.userWallets as any[]) || [];
}
function pickSol(): any {
  return userWallets().find((w) => /sol/i.test(w.chain)) || null;
}
function pickEvm(): any {
  return userWallets().find((w) => /evm|eip155|eth/i.test(w.chain)) || null;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wallet addresses taken from the authenticated user's verified credentials.
 *
 * Fallback for when the wallet objects never materialise in userWallets — the
 * SDK logs "Wallet not found for verified credential" in that state (typically
 * after the iframe 401s and logs itself out), yet the credentials still carry
 * the real addresses, which is enough for deposits and balances.
 */
function addressesFromCredentials(): { evm?: string; solana?: string } {
  const out: { evm?: string; solana?: string } = {};
  try {
    const creds =
      ((dynamicClient.auth as any)?.authenticatedUser?.verifiedCredentials as any[]) || [];
    for (const c of creds) {
      const addr: string | undefined = c?.address;
      if (!addr) continue;
      const chain = String(c?.chain || "").toLowerCase();
      const looksEvm = /^0x[0-9a-fA-F]{40}$/.test(addr);
      const looksSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
      if (!out.evm && (chain.includes("eip155") || chain.includes("evm") || looksEvm)) {
        out.evm = addr;
      } else if (!out.solana && (chain.includes("sol") || looksSol)) {
        out.solana = addr;
      }
    }
  } catch {}
  return out;
}

export interface DynamicAddresses {
  evm: string;
  solana: string;
  movement: string;
}

/** Whether Dynamic reports a signed-in session (WebView SDK ready + authed). */
export function isDynamicAuthenticated(): boolean {
  try {
    return !!(dynamicClient.auth as any).token;
  } catch {
    return false;
  }
}

/** Current Dynamic access-token JWT (for exchanging with our backend). */
export function getDynamicToken(): string | null {
  try {
    return (dynamicClient.auth as any).token ?? null;
  } catch {
    return null;
  }
}

/**
 * Wait for Dynamic's auth token after OTP verification.
 *
 * verifyOTP() resolving does NOT mean the auth state has landed — the SDK
 * settles it asynchronously across the WebView bridge, so reading auth.token
 * immediately returns null and the sign-in looks like it failed.
 */
export async function waitForDynamicToken(timeoutMs = 10000): Promise<string | null> {
  const started = Date.now();
  try {
    await (dynamicClient.auth as any).waitForAuthSuccess?.();
  } catch {
    // Fall through to polling — the token may still arrive.
  }
  while (Date.now() - started < timeoutMs) {
    const t = getDynamicToken();
    if (t) return t;
    await new Promise((r) => setTimeout(r, 200));
  }
  return getDynamicToken();
}

/**
 * Ensure the user's embedded wallet exists (EVM + Solana). Loads existing wallets
 * first (so we never re-create — which errors), then creates only missing chains.
 */
export async function ensureDynamicWallet(): Promise<void> {
  // 1) Load any wallet that already exists (populates userWallets).
  let existing: any = null;
  try {
    existing = await dynamicClient.wallets.embedded.getWallet();
  } catch {}
  if (existing || dynamicClient.wallets.embedded.hasWallet) {
    for (let i = 0; i < 10 && userWallets().length === 0; i++) await sleep(300);
  }

  const missing = (): string[] => {
    const out: string[] = [];
    if (!pickEvm()) out.push("Evm");
    if (!pickSol()) out.push("Sol");
    return out;
  };
  if (missing().length === 0) return;

  // 2) Create only what's missing. WaaS creation can fail transiently (the
  //    signed session needs a beat to settle right after OTP verification), so
  //    retry with backoff and keep the real error for diagnostics.
  // Keep the total budget small (~8s). This runs on app start, so a long
  // retry loop here makes the whole app feel frozen while it fails.
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const need = missing();
    if (need.length === 0) return;
    try {
      await dynamicClient.wallets.embedded.createWallet({ chains: need as any });
      lastErr = null;
    } catch (e: any) {
      lastErr = e;
    }
    // Wait for the store to reflect the new wallet(s).
    for (let i = 0; i < 10 && missing().length > 0; i++) await sleep(300);
    if (missing().length === 0) return;
    await sleep(800);
  }

  if (missing().length > 0) {
    const detail =
      lastErr?.message ||
      (lastErr ? JSON.stringify(lastErr).slice(0, 300) : "no wallet returned");
    throw new Error(`Dynamic createWallet failed for ${missing().join(", ")}: ${detail}`);
  }
}

/**
 * Can this client make a TON wallet, and what does it look like?
 *
 * PARKED. Nothing calls this while PROBE_TON_WALLET is false in AppContext -
 * as of 2026-09-27 Dynamic refuses with invalid_chains, "not enabled for
 * embedded wallets: TON", though TON is switched on in both the chain list
 * and the embedded-wallet settings, the environment id matches and mainnet
 * -239 is configured. Open with their support. Flip the flag to re-test.
 *
 * Kept rather than deleted because the answer would change what we build: a
 * Dynamic TON wallet comes with a real recovery phrase, which is the one
 * thing a wallet derived from the Solana key can never have. Today that gap
 * means the only app a TON export can be imported into is My Wallet.
 *
 * The question this settles is narrow: Dynamic's own TON package hardcodes
 * WalletContractV5R1, so a Dynamic TON wallet is W5 and gasless works - but
 * that package is built on the WEB sdk, and this app is on the React Native
 * client, which ships no TON module and lists no TON chain in its typings.
 * The client passes chain names straight through to Dynamic's backend rather
 * than checking them against an enum, so it may simply work. "May" is not
 * enough to plan a migration on.
 *
 * What matters in the output: whether a TON wallet comes back at all, and
 * the address it has. Everything else is noise for reading the failure.
 *
 * Creates a real wallet on the signed-in account if it succeeds. That is
 * additive - it cannot disturb the EVM and Solana wallets already there, and
 * an account with an unused TON wallet is in no worse a state than one
 * without.
 */
export async function probeTonWallet(): Promise<void> {
  const line = (...a: any[]) => console.log("[TON-PROBE]", ...a);
  try {
    line("chains this account already has:",
      userWallets().map((w) => w.chain).join(", ") || "(none loaded)");

    const already = userWallets().find((w) => /ton/i.test(String(w.chain || "")));
    if (already) {
      line("ALREADY HAS ONE — chain:", already.chain, "address:", already.address);
      return;
    }

    line("asking for chains: [\"Ton\"] ...");
    await dynamicClient.wallets.embedded.createWallet({ chains: ["Ton"] as any });

    // The store needs a beat to reflect a new wallet.
    for (let i = 0; i < 12 && !userWallets().some((w) => /ton/i.test(String(w.chain || ""))); i++) {
      await sleep(400);
    }
    const made = userWallets().find((w) => /ton/i.test(String(w.chain || "")));
    if (made) {
      line("SUCCESS — chain:", made.chain);
      line("           address:", made.address);
      line("           (Dynamic deploys WalletContractV5R1, so this is a W5)");
    } else {
      line("NO ERROR, BUT NO WALLET — createWallet returned and nothing appeared.");
      line("chains now:", userWallets().map((w) => w.chain).join(", "));
    }
  } catch (e: any) {
    line("FAILED:", e?.message || JSON.stringify(e)?.slice(0, 300));
    line("→ the React Native client will not make a TON wallet on this version.");
  }
}

/** Derive all chain addresses from the Dynamic embedded wallet. */
export async function getDynamicWalletAddresses(): Promise<DynamicAddresses> {
  let ensureErr: any = null;
  try {
    await ensureDynamicWallet();
  } catch (e) {
    // Keep going: the credentials below may still hold the addresses even when
    // wallet creation/loading blew up (e.g. the SDK's internal
    // "Cannot read property 'replace' of undefined" on an unauthorised session).
    ensureErr = e;
  }

  let evmAddr: string | undefined = pickEvm()?.address;
  let solAddr: string | undefined = pickSol()?.address;

  if (!evmAddr || !solAddr) {
    const fromCreds = addressesFromCredentials();
    evmAddr = evmAddr || fromCreds.evm;
    solAddr = solAddr || fromCreds.solana;
  }

  if (!evmAddr || !solAddr) {
    const missingNames = [!evmAddr && "EVM", !solAddr && "Solana"].filter(Boolean).join(" + ");
    throw new Error(
      `No Dynamic ${missingNames} address (wallets=${userWallets().length}, ` +
        `authed=${isDynamicAuthenticated()})` +
        (ensureErr ? ` — ${ensureErr?.message || String(ensureErr)}` : "")
    );
  }

  return {
    evm: evmAddr,
    solana: solAddr,
    movement: movementAddrFromPubkey(bs58Decode(solAddr)),
  };
}

// ─── signing readiness ──────────────────────────────────────
//
// Dynamic signs inside a WebView. If that WebView is not ready - still booting,
// or its WaaS session was revoked - signMessage simply never settles. Nothing
// rejects, so the UI sits on "Signing transaction…" forever with no error to
// show. Every signing path therefore waits for readiness first and races the
// call against a clock, so the worst case is a message the user can act on.

const SIGN_TIMEOUT_MS = 45_000;
const READY_TIMEOUT_MS = 20_000;
// How long to let a keychain-restored session finish arriving before calling
// it expired. Generous: the cost of waiting is a pause, the cost of giving up
// early is sending someone to sign in again for no reason.
const SESSION_RESTORE_TIMEOUT_MS = 8000;

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} timed out. Check your connection and try again.`)),
      ms
    );
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Make sure the signer can actually run before asking it to.
 *
 * Also waits briefly for the wallet list to populate: it arrives asynchronously
 * after the session restores, and a signing attempt in that gap would otherwise
 * fail with a confusing "no wallet" when the wallet exists and is moments away.
 */
export async function ensureSignerReady(): Promise<void> {
  await withTimeout(dynamicClient.sdk.waitForReady(), READY_TIMEOUT_MS, "Secure signing");

  /**
   * Wait for the token rather than reading it once.
   *
   * Auth settles asynchronously across the WebView bridge - which is why
   * waitForDynamicToken exists for the OTP case - and the same is true of a
   * session restored from the keychain on a cold start. waitForReady() resolving
   * says the SDK booted, not that auth has landed, so an instant check finds
   * null and reports an expired session on one that is merely still arriving.
   *
   * That read as sessions expiring within hours against a 30-day JWT: the token
   * was fine, it just had not been handed across yet when signing was asked for.
   */
  if (!isDynamicAuthenticated()) {
    // Held to its limit from out here: the SDK's own wait never settles when no
    // sign-in is coming, which left a send on "Processing" before it had started.
    await withTimeout(waitForDynamicToken(SESSION_RESTORE_TIMEOUT_MS), SESSION_RESTORE_TIMEOUT_MS, "Secure signing").catch(() => null);
  }

  /**
   * Nothing can be signed until they sign in again - the code by email is what
   * renews it. Saying "sign in again" and leaving them signed in meant finding
   * Sign out themselves, and until they did, every send failed the same way.
   * So this signs out and opens sign-in, with a line saying why.
   */
  if (!isDynamicAuthenticated()) {
    endSession("wallet");
    throw new SessionEndedError("Your secure session has expired. Please sign in again.");
  }

  for (let i = 0; i < 10 && userWallets().length === 0; i++) {
    await sleep(300);
  }
}

/**
 * Whether the signer turned us down because the sign-in behind it is no longer
 * good, rather than for anything about the transaction.
 *
 * The token can still be on the phone after the session behind it has lapsed,
 * so ensureSignerReady lets it through and the refusal only comes back from the
 * signer itself. Read as an ordinary error, that marked the transfer failed,
 * showed the signer's own words and left the person signed in, so the next try
 * failed the same way.
 */
function signerSessionGone(e: unknown): boolean {
  const err = e as { status?: number; code?: string | number; message?: string; response?: { status?: number } } | null;
  const status = err?.status ?? err?.response?.status;
  if (status === 401) return true;
  const words = `${err?.code ?? ""} ${err?.message ?? ""}`.toLowerCase();
  return /unauthori[sz]ed|unauthenticated|not authenticated|jwt|session (has )?expired|expired session|token (has )?expired|expired token|invalid token|session not found|no active session|login required|sign ?in again|log ?in again/.test(words);
}

/** Runs one signing call; a refusal for the sign-in ends the session the same way ensureSignerReady does. */
async function signing<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (signerSessionGone(e)) {
      endSession("wallet");
      throw new SessionEndedError("Your secure session has expired. Please sign in again.");
    }
    throw e;
  }
}

/**
 * Sign a hex-encoded message with the Ed25519 (Solana) key — used for BOTH
 * Movement and Solana, since Movement shares that key. Returns hex signature +
 * hex public key, matching the shape the backend expects.
 */
export async function signEd25519Hex(
  hexMessage: string
): Promise<{ signature: string; publicKey: string }> {
  await ensureSignerReady();

  const sol = pickSol();
  if (!sol) throw new Error("No Dynamic Solana wallet");

  let res: any;
  setDynamicWebViewVisible(true);
  try {
    res = await signing(() =>
      withTimeout(dynamicClient.wallets.signMessage({ wallet: sol, message: hexMessage }), SIGN_TIMEOUT_MS, "Signing")
    );
  } finally {
    // finally, not after the await: a timeout or rejection must still put the
    // WebView back, or it would sit over the app permanently.
    setDynamicWebViewVisible(false);
  }

  const signed: string = res?.signedMessage ?? res?.signature ?? "";
  if (!signed) throw new Error("Dynamic signMessage returned no signature");
  return {
    signature: bytesToHex(bs58Decode(signed)),
    publicKey: bytesToHex(bs58Decode(sol.address)),
  };
}

/**
 * Sign a whole EVM transaction and return the raw signed bytes.
 *
 * The Ed25519 path signs a bare 32-byte hash, but Dynamic's EVM signer will not
 * do that - and rightly so: signing an opaque hash with a secp256k1 key is the
 * blind-signing hazard that lets a malicious payload drain a wallet. So the
 * transaction is signed as a transaction, which also means the wallet can show
 * the user what they are actually approving.
 *
 * Returns the serialised signed transaction rather than a bare signature,
 * because that is the only form guaranteed to match what was signed. The
 * backend re-parses it and checks every field against the transaction it
 * prepared before broadcasting, so nothing here is taken on trust.
 */
export async function signEvmTx(txRequest: any): Promise<{ signedRaw: string; address: string }> {
  await ensureSignerReady();

  // Sign with the account the backend prepared for, not merely the first EVM
  // wallet we hold. Picking the wrong one still produces a valid signature - it
  // just recovers to an address the backend refuses, which reads as a baffling
  // "did not match" rather than "wrong account".
  const wanted = String(txRequest.from || "").toLowerCase();
  const evm = wanted
    ? userWallets().find((w) => String(w.address || "").toLowerCase() === wanted)
    : pickEvm();

  if (!evm) {
    throw new Error(
      wanted
        ? "Your wallet no longer holds the account this transaction was prepared for. Sign out and back in, then try again."
        : "No Dynamic EVM wallet"
    );
  }

  // An account, not a wallet client.
  //
  // createWalletClient defaults to Ethereum mainnet unless given a `chain`, and
  // its transport then forwarded eth_signTransaction to a public RPC node -
  // which of course does not hold an MPC account, so it came back "unknown
  // account" for a chainId we never asked for.
  //
  // createAccountFromWallet returns a viem local account that signs through
  // Dynamic directly. No transport, no RPC, and the chain is whatever the
  // transaction itself says.
  const account: any = (dynamicClient as any).viem.createAccountFromWallet(evm);

  // viem wants bigints and 0x strings; the backend sends JSON, so everything
  // numeric arrives as a decimal or hex string and has to be converted back.
  const big = (v: any) => (v === undefined || v === null ? undefined : BigInt(v));

  const tx: any = {
    to: txRequest.to,
    data: txRequest.data ?? undefined,
    value: big(txRequest.value) ?? 0n,
    nonce: Number(txRequest.nonce),
    chainId: Number(txRequest.chainId),
    gas: big(txRequest.gasLimit ?? txRequest.gas),
    type: txRequest.type === 0 ? "legacy" : "eip1559",
  };

  if (tx.type === "legacy") {
    tx.gasPrice = big(txRequest.gasPrice);
  } else {
    tx.maxFeePerGas = big(txRequest.maxFeePerGas);
    tx.maxPriorityFeePerGas = big(txRequest.maxPriorityFeePerGas);
  }

  let signedRaw: string;
  setDynamicWebViewVisible(true);
  try {
    signedRaw = await signing(() => withTimeout(account.signTransaction(tx), SIGN_TIMEOUT_MS, "Signing"));
  } finally {
    setDynamicWebViewVisible(false);
  }
  if (!signedRaw) throw new Error("Dynamic signTransaction returned nothing");

  return { signedRaw, address: evm.address };
}

/** The elevated scope Dynamic wants before it will hand over a key. */
const EXPORT_SCOPE = "wallet:export";

/** Which of the account's two embedded wallets to reveal. */
export type RevealTarget = "evm" | "sol";

/**
 * Open Dynamic's own reveal screen for one of the embedded wallets.
 *
 * Three things have to line up, all of them Dynamic's:
 *
 *  1. The project must allow private key exports.
 *  2. The session must have been verified again just now - the dashboard calls
 *     this step-up verification and it is mandatory from API version
 *     2026_04_01. Skipping it returns 403 Forbidden from exportPrivateKey.
 *  3. The reveal screen takes no wallet argument, so it shows whichever wallet
 *     is primary. Exporting the Ed25519 key that Movement and Solana share
 *     therefore means making that wallet primary for the duration and putting
 *     the original back afterwards.
 *
 * The key shares stay Dynamic's throughout - their UI renders inside the
 * WebView host and all this decides is which wallet it is pointed at and when
 * the host is on screen.
 */
export async function revealDynamicKey(
  type: "recovery-phrase" | "private-key",
  target: RevealTarget = "evm",
): Promise<void> {
  const wallets: any = dynamicClient.wallets as any;
  const embedded: any = wallets?.embedded;
  const stepUp: any = (dynamicClient as any)?.stepUpAuth;

  // Wallets are not loaded until getWallet() has run at least once.
  try { await embedded?.getWallet?.(); } catch {}

  const wanted = target === "sol" ? pickSol() : pickEvm();
  if (!wanted) throw new Error(target === "sol" ? "NO_SOL_WALLET" : "NO_EVM_WALLET");

  const previous = wallets?.primary ?? null;
  const mustSwap = !!wanted.id && previous?.id !== wanted.id;

  setDynamicWebViewVisible(true);
  try {
    if (mustSwap) await wallets.setPrimary({ walletId: wanted.id });

    if (stepUp?.promptStepUpAuth) {
      let needed = true;
      try {
        needed = await stepUp.isStepUpRequired({ scope: EXPORT_SCOPE });
      } catch {
        // If the check itself fails, prompt anyway: one extra verification
        // beats a 403 the user can do nothing about.
      }

      if (needed) {
        await stepUp.promptStepUpAuth({ requestedScopes: [EXPORT_SCOPE] }).catch(() => null);

        // Ask again rather than trusting the return value. The prompt resolves
        // without handing back a token even when the user did verify, so
        // reading it as a cancel meant the email step succeeded and then
        // nothing opened - the export had to be tapped a second time to get
        // the reveal. Whether the scope is still required is the honest
        // signal, and it also catches a genuine back-out.
        let stillRequired = false;
        try {
          stillRequired = await stepUp.isStepUpRequired({ scope: EXPORT_SCOPE });
        } catch {
          // Unanswerable: let the reveal decide rather than blocking here.
        }
        if (stillRequired) throw new Error("STEP_UP_CANCELLED");
      }
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let offSuccess: (() => void) | undefined;
      let offFailure: (() => void) | undefined;

      const finish = (err?: any) => {
        if (settled) return;
        settled = true;
        try { offSuccess?.(); } catch {}
        try { offFailure?.(); } catch {}
        if (err) reject(normaliseRevealError(err));
        else resolve();
      };

      try {
        offSuccess = embedded?.on?.("embeddedWalletRevealSuccess", () => finish());
        offFailure = embedded?.on?.("embeddedWalletRevealFailure", (e: any) => finish(e ?? new Error("REVEAL_FAILED")));

        // Typed as void, but the transport rejects on an API error -
        // unhandled, that surfaced as a red box instead of a message.
        const pending: any = (dynamicClient.ui as any).wallets.revealEmbeddedWalletKey({ type });
        if (pending && typeof pending.then === "function") {
          pending.then(undefined, (e: any) => finish(e));
        }
      } catch (e) {
        finish(e);
      }
    });
  } finally {
    // The primary wallet is what the rest of the app signs and displays
    // against, so it must go back even if the reveal failed or was cancelled.
    if (mustSwap && previous?.id) {
      try { await wallets.setPrimary({ walletId: previous.id }); } catch {}
    }
    // And the host must come off the screen, or it sits over the app.
    setDynamicWebViewVisible(false);
  }
}

/**
 * Dynamic reports transport failures as a nested rejectionReason, so the
 * useful part is buried under two layers of JSON.
 */
function normaliseRevealError(err: any): Error {
  const raw =
    err?.rejectionReason?.message ??
    err?.message ??
    (typeof err === "string" ? err : "");

  // 403 after a successful step-up means the project itself refuses exports.
  if (/forbidden/i.test(raw) || err?.rejectionReason?.name === "WalletApiError") {
    const e = new Error("EXPORT_FORBIDDEN");
    (e as any).detail = raw;
    return e;
  }
  return new Error(raw || "REVEAL_FAILED");
}

/** Puts the Dynamic WebView away if a reveal was left open. */
export function closeDynamicWebView(): void {
  setDynamicWebViewVisible(false);
}

/** Log out of the Dynamic session (used on full app logout). */
export async function dynamicLogout(): Promise<void> {
  try {
    await dynamicClient.auth.logout();
  } catch {}
}
