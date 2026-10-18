/**
 * Settings, checked once at start.
 *
 * Anything missing or malformed stops the service before it takes a request,
 * rather than failing on the first sign-in. Staging and production are held to
 * more than development: no email key there is a refusal to start, not a
 * console print, because a code printed to a shared log is a code anyone can use.
 */
import { z } from "zod";

/** A variable added on Railway with no value yet reads as unset, not as an empty value that fails its format. */
const emptyAsUnset = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v), t);

const schema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4100),
  DATABASE_URL: z.string().url(),
  ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  // Keys are trimmed: a value pasted or piped in often carries an invisible line break.
  COOKIE_DOMAIN: z.string().trim().optional(),
  CODE_PEPPER: z.string().trim().min(32, "CODE_PEPPER must be at least 32 characters"),
  RESEND_API_KEY: z.string().trim().optional(),
  EMAIL_FROM: z.string().default("Money Moves Business <noreply@usemoneymoves.xyz>"),
  GOOGLE_CLIENT_ID: z.string().trim().optional(),
  /** Shared with the dashboard's proxy, which uses it to vouch for the visitor's address. */
  PROXY_SECRET: z.string().trim().min(32).optional(),
  /**
   * What live naira payments run on. Test mode always runs on the simulator,
   * whatever this says.
   *  - simulated: nothing real anywhere - development and staging;
   *  - off: live naira payments and bank lookups refuse politely;
   *  - flutterwave: the real rail - one-time accounts in, payouts from the payout balance.
   * Unset, it's simulated outside production and off in production.
   */
  NAIRA_RAILS: z.enum(["simulated", "off", "flutterwave"]).optional(),
  /** Where the naira rate comes from: the Money Moves app's public rates, so both quote the same. */
  RATES_URL: z.string().url().default("https://backend-production-6f042.up.railway.app/api/rates"),
  /** The Money Moves app's backend. The admin console signs in there, and an admin here is whoever it says is one. */
  APP_API_URL: z.string().url().default("https://backend-production-6f042.up.railway.app"),
  /** The checkout's own address (https://pay.usemoneymoves.xyz), where links are /slug and /i/token. Unset: the dashboard's, under /pay. */
  PAY_ORIGIN: emptyAsUnset(z.string().url().optional()),
  /**
   * The admin action password, as a scrypt hash (npm run action-password-hash) - the
   * second lock on deactivating a business, verifying one, changing its name or fee, and
   * moving a settlement by hand. Without it those actions are refused, not left open.
   */
  ADMIN_ACTION_PASSWORD_HASH: z.string().trim().optional(),
  /** Encrypts the documents businesses upload: 32 random bytes, base64. Required outside development (lib/vault). */
  DOCS_KEY: z.string().trim().optional(),
  /** Keys DOCS_KEY used to be, comma-separated - kept so the files they locked still open after the key changes (lib/vault). */
  DOCS_KEYS_OLD: z.string().trim().optional(),
  /**
   * Flutterwave v4, the same account and credentials as the app: whose a bank account is, everywhere they're
   * set, and the live rail when NAIRA_RAILS=flutterwave. Without the pair, staging and production can't check
   * accounts, and say so rather than faking a name. Sandbox unless the base URL says otherwise.
   */
  /** Shared with the app's backend: signs our requests to link a Money Moves account (the owner approves in the app). Without it, linking says it isn't on. */
  BUSINESS_LINK_SECRET: z.string().trim().min(32).optional(),
  FLUTTERWAVE_CLIENT_ID: z.string().trim().optional(),
  FLUTTERWAVE_CLIENT_SECRET: z.string().trim().optional(),
  FLUTTERWAVE_BASE_URL: z.string().url().default("https://developersandbox-api.flutterwave.com"),
  FLUTTERWAVE_TOKEN_URL: z.string().url().default("https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token"),
  /** The company named on payouts - the same one the app pays out under. */
  FLUTTERWAVE_SENDER_NAME: z.string().default("Movers Digital Technologies Ltd"),
  /**
   * The identity one-time accounts are issued under when a business hasn't
   * given its own BVN: the company's BVN or NIN (one is enough). Flutterwave
   * won't issue an account without one. A business's accepted BVN is used
   * instead whenever it has one.
   */
  FLUTTERWAVE_COLLECTIONS_BVN: emptyAsUnset(z.string().regex(/^\d{11}$/, "an 11-digit BVN").optional()),
  FLUTTERWAVE_COLLECTIONS_NIN: emptyAsUnset(z.string().regex(/^\d{11}$/, "an 11-digit NIN").optional()),
  /** Didit, for the account representative's identity check. Without both, the check says it's unavailable - it's never simulated. */
  DIDIT_API_KEY: z.string().trim().optional(),
  DIDIT_WORKFLOW_ID: z.string().trim().optional(),
  DIDIT_BASE_URL: z.string().url().default("https://verification.didit.me"),
  // ─── On-chain (stablecoin payments, business wallets and the USDC float) ───
  // All optional: until a value is set, the part that needs it stays off. Same
  // providers and patterns as the app (backend/src/config/env.ts), with this
  // service's own wallets - the business side keeps its own treasury.

  /**
   * Business wallets are the owner's own: they sign in to a Dynamic environment of its own (not the
   * app's) from the dashboard, and approve every payout there. We never hold a key. The API only checks
   * that a wallet address really belongs to the signed-in owner, against this environment's public keys.
   */
  DYNAMIC_ENVIRONMENT_ID: emptyAsUnset(z.string().optional()),

  /** Gas, as the app pays it: Shinami sponsors Movement; a fee payer covers Solana; a sponsor tops up EVM chains (Arc pays its own way). */
  SHINAMI_ACCESS_KEY: emptyAsUnset(z.string().optional()),
  SOLANA_GASLESS_PRIVATE_KEY: emptyAsUnset(z.string().optional()),
  EVM_GAS_SPONSOR_PRIVATE_KEY: emptyAsUnset(z.string().optional()),

  /** Where each network is read and written. */
  MOVEMENT_RPC_URL: emptyAsUnset(z.string().url().optional()),
  MOVEMENT_INDEXER_URL: emptyAsUnset(z.string().url().optional()),
  SOLANA_RPC_URL: emptyAsUnset(z.string().url().optional()),
  BASE_RPC_URL: emptyAsUnset(z.string().url().optional()),
  BSC_RPC_URL: emptyAsUnset(z.string().url().optional()),
  ARB_RPC_URL: emptyAsUnset(z.string().url().optional()),
  ARC_RPC_URL: emptyAsUnset(z.string().url().optional()),
  MONAD_RPC_URL: emptyAsUnset(z.string().url().optional()),
  ETHEREUM_RPC_URL: emptyAsUnset(z.string().url().optional()),
  OPTIMISM_RPC_URL: emptyAsUnset(z.string().url().optional()),
  TONAPI_BASE_URL: emptyAsUnset(z.string().url().optional()),
  TONAPI_KEY: emptyAsUnset(z.string().optional()),
  STELLAR_HORIZON_URL: emptyAsUnset(z.string().url().optional()),
  /** Stellar RPC, which replaces Horizon for new work. */
  STELLAR_RPC_URL: emptyAsUnset(z.string().url().optional()),

  /** Where customers' stablecoin payments are collected, per kind of network. Addresses only - nothing here can spend. */
  TREASURY_EVM_ADDRESS: emptyAsUnset(z.string().regex(/^0x[0-9a-fA-F]{40}$/, "an EVM address").optional()),
  TREASURY_MOVEMENT_ADDRESS: emptyAsUnset(z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, "a Movement address").optional()),
  TREASURY_SOLANA_ADDRESS: emptyAsUnset(z.string().optional()),
  TREASURY_TON_ADDRESS: emptyAsUnset(z.string().optional()),
  TREASURY_STELLAR_ADDRESS: emptyAsUnset(z.string().regex(/^G[A-Z2-7]{55}$/, "a Stellar address").optional()),

  /**
   * The seed every payment's own deposit address is made from: 32 random bytes, hex or base64. The
   * addresses are worked out from it and the payment's id, never stored as keys - so this one value
   * must be kept safe and backed up, and never changed while any address still holds money.
   * Without it, payments are told apart by exact amount on our treasury, as before.
   */
  DEPOSIT_SEED: emptyAsUnset(z.string().optional()),

  /** The USDC float businesses are paid from, on each settle chain (Arc and Monad share the EVM key). */
  FLOAT_MOVEMENT_PRIVATE_KEY: emptyAsUnset(z.string().optional()),
  FLOAT_SOLANA_PRIVATE_KEY: emptyAsUnset(z.string().optional()),
  FLOAT_EVM_PRIVATE_KEY: emptyAsUnset(z.string().optional()),

  /** The background worker (payment checks, settlements) runs in this process unless this is "false". */
  RUN_WORKER: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Names only - never the values, which may be secrets.
  const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  console.error("[env] The business API can't start:\n  " + problems.join("\n  "));
  process.exit(1);
}

export const env = {
  ...parsed.data,
  NAIRA_RAILS: parsed.data.NAIRA_RAILS ?? (parsed.data.APP_ENV === "production" ? "off" : "simulated"),
};
export const isDev = env.APP_ENV === "development";

// Production never pretends: a simulated payout there would tell a business it was paid when it wasn't.
if (env.APP_ENV === "production" && env.NAIRA_RAILS === "simulated") {
  console.error("[env] NAIRA_RAILS=simulated isn't allowed in production. Use off until the live rail is connected.");
  process.exit(1);
}
// The live rail needs its credentials; without them it would refuse every payment one at a time.
if (env.NAIRA_RAILS === "flutterwave" && !(env.FLUTTERWAVE_CLIENT_ID && env.FLUTTERWAVE_CLIENT_SECRET)) {
  console.error("[env] NAIRA_RAILS=flutterwave needs FLUTTERWAVE_CLIENT_ID and FLUTTERWAVE_CLIENT_SECRET.");
  process.exit(1);
}

if (!isDev) {
  const missing: string[] = [];
  if (!env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
  if (env.ALLOWED_ORIGINS.length === 0) missing.push("ALLOWED_ORIGINS");
  if (env.CODE_PEPPER.startsWith("change-me")) missing.push("CODE_PEPPER (still the example value)");
  if (!env.DOCS_KEY) missing.push("DOCS_KEY");
  if (missing.length) {
    console.error(`[env] ${env.APP_ENV} needs: ${missing.join(", ")}`);
    process.exit(1);
  }
}
