import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: z.string().url(),
  BASE_URL: z.string().url().optional(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY: z.string().default("15m"),
  JWT_REFRESH_EXPIRY: z.string().default("30d"),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().default("noreply@moneymoves.app"),

  APP_NAME: z.string().default("Money Moves"),
  FRONTEND_URL: z.string().url().default("http://localhost:8081"),

  MAX_LOGIN_ATTEMPTS: z.coerce.number().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().default(15),
  MAX_PIN_ATTEMPTS: z.coerce.number().default(5),
  PIN_LOCKOUT_MINUTES: z.coerce.number().default(15),

  // MetaMap KYC (deprecated — using manual now)
  METAMAP_CLIENT_ID: z.string().optional(),
  METAMAP_CLIENT_SECRET: z.string().optional(),
  METAMAP_WEBHOOK_SECRET: z.string().optional(),
  METAMAP_API_URL: z.string().url().default("https://api.prod.metamap.com"),

  // Shinami (Movement gas sponsorship)
  SHINAMI_ACCESS_KEY: z.string().optional(),

  // Gelato Relay (EVM gas sponsorship) – legacy, kept for backwards compat
  GELATO_API_KEY: z.string().optional(),

  // NEAR Intents 1Click API JWT — for cross-chain deposits that
  // settle as USDCx on Movement. Sign up free at
  // https://partners.near-intents.org/home
  NEAR_INTENTS_JWT: z.string().optional(),

  // RPC endpoints
  MOVEMENT_RPC_URL: z.string().url().default("https://mainnet.movementnetwork.xyz/v1"),
  MOVEMENT_INDEXER_URL: z.string().url().default("https://indexer.mainnet.movementnetwork.xyz/v1/graphql"),
  SOLANA_RPC_URL: z.string().url().default("https://api.mainnet.solana.com"),
  SOLANA_RPC_FALLBACK: z.string().url().default("https://api.mainnet.solana.com"),
  BASE_RPC_URL: z.string().url().default("https://mainnet.base.org"),
  // bnbchain.org measured consistently faster than bsc-dataseed.binance.org.
  BSC_RPC_URL: z.string().url().default("https://bsc-dataseed1.bnbchain.org"),
  ARB_RPC_URL: z.string().url().default("https://arb1.arbitrum.io/rpc"),
  /**
   * Arc, not Arbitrum. The line above is Arbitrum.
   *
   * Worth saying because ARB and ARC differ by one letter, sit next to each
   * other in every map that follows, and are both EVM - so a transposition
   * sends real money to a working RPC on the wrong chain and nothing errors.
   */
  ARC_RPC_URL: z.string().url().default("https://rpc.mainnet.arc.io"),
  /**
   * Monad (chain 143). Ankr's public node by default: it takes batch calls and
   * an eth_getLogs range of 1,000 blocks, where rpc.monad.xyz caps logs at 100
   * - about forty seconds of Monad - which is too short to find a deposit by.
   */
  MONAD_RPC_URL: z.string().url().default("https://rpc3.monad.xyz"),

  /**
   * TON, which is read through an indexer rather than an RPC node.
   *
   * A jetton arrival is several transactions that only an indexer reassembles
   * into one "somebody was paid" event, and there is no log filter to sweep
   * the way EVM has - so TonAPI is not an optimisation here, it is the only
   * practical way to see a deposit.
   *
   * The key is optional and unkeyed requests do work, but they are rate
   * limited hard enough that a burst of balance reads starts coming back
   * empty. Set it before this carries real traffic.
   */
  TONAPI_BASE_URL: z.string().url().default("https://tonapi.io"),
  TONAPI_KEY: z.string().optional(),
  /**
   * How fast we may call TonAPI, in requests per second.
   *
   * One is the free tier, and going over it does not return 429 - it drops
   * the connection or hands back an empty body, which reads as an empty
   * wallet. So requests are queued to this rate rather than raced; see the
   * throttle in lib/ton.ts. Raise it here the day the plan changes.
   */
  TONAPI_RPS: z.coerce.number().positive().default(1),

  // ── Flutterwave (v4) — the live payment rail, on-ramp AND off-ramp ──
  //
  // v4 authenticates with OAuth client credentials, not the classic FLWSECK-
  // secret key: we exchange client id/secret for a 10-minute bearer token. All
  // three are SECRET and must never reach the app bundle.
  //
  // Optional so a missing credential never blocks boot - the endpoints report
  // clearly when Flutterwave is not configured instead of the server refusing
  // to start.
  FLUTTERWAVE_CLIENT_ID: z.string().optional(),
  FLUTTERWAVE_CLIENT_SECRET: z.string().optional(),
  // Sandbox by default, deliberately: an unset base URL should never be able to
  // move real money. Live is https://f4bexperience.flutterwave.com and must be
  // set explicitly, with the live client credentials to match - sandbox and
  // production issue separate ones, though both use the same token endpoint.
  FLUTTERWAVE_BASE_URL: z.string().url().default("https://developersandbox-api.flutterwave.com"),
  FLUTTERWAVE_TOKEN_URL: z
    .string()
    .url()
    .default("https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token"),
  // The name the recipient's bank should show as the sender. Dashboard
  // transfers already display the company name; API transfers show a generic
  // "TRF" unless a sender is attached to them.
  FLUTTERWAVE_SENDER_NAME: z.string().default("Movers Digital Technologies Ltd"),

  // The transfer narration, which lands in the recipient's statement as the
  // description. A dashboard transfer that read "From Movers Digital
  // Technologies Ltd" showed the company name at the receiving bank, while an
  // API transfer narrated "Money Moves" showed a generic "TRF" - so this
  // deliberately mirrors the wording that worked.
  FLUTTERWAVE_NARRATION: z.string().default("From Movers Digital Technologies Ltd"),

  // The "secret hash" set on the Flutterwave dashboard. Webhooks arrive signed
  // with it; without it we cannot trust a webhook and will reject every one.
  FLUTTERWAVE_WEBHOOK_SECRET: z.string().optional(),
  // Shared with Money Moves Business: signs its requests to link a person's account (they approve in the app).
  // Without it, the internal link routes answer 404 as if they weren't there.
  BUSINESS_LINK_SECRET: z.string().min(32).optional(),
  // Money Moves Business's API, for opening a checkout scanned with the app (same secret as above).
  BUSINESS_API_URL: z.string().url().default("https://business-api-production-ddf5.up.railway.app"),

  /**
   * Flutterwave v3, for bills and only bills.
   *
   * Bills do not exist in v4. Their documentation is v3, their endpoints are
   * on api.flutterwave.com/v3, and they authenticate with the old secret key
   * rather than the OAuth client credentials everything else here uses - so
   * running both versions side by side is not a choice, it is the only way to
   * put bills on Flutterwave at all.
   *
   * Optional throughout. With no key, bills stay on vtu.ng and the console
   * shows Flutterwave as unavailable rather than letting it be chosen, the
   * same way an unconfigured payout rail behaves.
   */
  FLW_V3_SECRET_KEY: z.string().optional(),
  /**
   * Expected to stay unset.
   *
   * Flutterwave gives an account one webhook configuration and it speaks
   * either v3 or v4 - the dashboard offers "Switch to V4 webhook", not a
   * second slot. Ours is v4 and it settles sell payouts and credits naira
   * deposits, so pointing the account at a v3 webhook would break both at
   * once. Bills are polled instead, which is how the current provider's bills
   * already settle.
   */
  FLW_V3_SECRET_HASH: z.string().optional(),
  FLW_V3_BASE_URL: z.string().url().default("https://api.flutterwave.com/v3"),

  /**
   * CoinGecko's demo key, for the prices every rate is built from. Optional:
   * without it the same endpoints answer on CoinGecko's keyless tier, which is
   * slower to refill but ample for a feed cached for ten minutes - so a missing
   * key never stops the rates.
   */
  COINGECKO_API_KEY: z.string().trim().optional(),

  // ── Retired rails ────────────────────────────────────────────────────────
  // Paystack (on-ramp) and Bachs (off-ramp) are superseded by Flutterwave. The
  // code is kept for reference and for reading historical transactions, but the
  // routes are switched off - see PAYMENTS_PROVIDER below. Both are now optional
  // so the server boots with the keys removed entirely.
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),
  BACH_API_KEY: z.string().optional(),
  BACH_BASE_URL: z.string().url().default("https://api.bachs.io"),

  // Single switch for which rail is live. Anything other than "flutterwave"
  // is refused at boot rather than silently reviving a retired provider.
  PAYMENTS_PROVIDER: z.enum(["flutterwave"]).default("flutterwave"),

  /**
   * How hard the sender-name check on naira deposits bites.
   *
   *   off     - do not check
   *   shadow  - record the verdict, deliver anyway
   *   enforce - hold anything that is not a match, for review
   *
   * Defaults to shadow, and deliberately: the rule was written against five
   * deposits from one bank, and holding real money on a rule nobody has watched
   * run is how you strand an honest customer. Move it to enforce once the
   * recorded verdicts say what real senders look like.
   */
  FUNDING_NAME_CHECK: z.enum(["off", "shadow", "enforce"]).default("shadow"),

  /**
   * Naira added to CoinGecko's dollar, one figure per side.
   *
   * The feed sits below the rate anyone here actually trades at, so it supplies
   * the movement and these supply the level: at a feed of ₦1,325.6 the defaults
   * put funding at ₦1,390.6 and selling at ₦1,358.1, and when the feed moves
   * both follow it. The gap between them is the spread.
   *
   * In the environment because the market moves faster than releases do.
   */
  /**
   * Stableyard — routed deposits (BTC, Tron USDT, Ethereum assets → USDCx).
   *
   * Optional on purpose. Production has none of these set and must keep
   * starting without them; the integration is expected to check
   * isStableyardConfigured() before offering anything, exactly as the bills
   * and Paystack rails do.
   *
   * Staging is the default base URL. The two environments differ by hostname
   * alone, so a typo here is the difference between a test and a live one -
   * prod-api is set deliberately or not at all.
   */
  STABLEYARD_BASE_URL: z.string().url().default("https://staging-api-v2.stableyard.fi"),
  STABLEYARD_APP_ID: z.string().default(""),
  STABLEYARD_APP_SECRET: z.string().default(""),

  /**
   * Aurora Intents — swaps between chains, and BTC / Tron USDT deposits that
   * arrive as USDC on Solana.
   *
   * Optional, like Stableyard: with no key, swaps report themselves off and
   * BTC and Tron stay on Stableyard exactly as before. The key comes from
   * Intents Studio. Persistent deposit addresses also need Aurora to approve
   * the organisation; until they do, creating one answers 403 and the deposit
   * screens say the option is unavailable.
   */
  AURORA_INTENTS_API_KEY: z.string().default(""),
  // Large incoming deposits: who is emailed, and from how many dollars.
  DEPOSIT_ALERT_EMAILS: z.string().default("coolexcollins@gmail.com"),
  DEPOSIT_ALERT_USD: z.coerce.number().default(500),
  AURORA_INTENTS_BASE_URL: z.string().url().default("https://intents-api.aurora.dev"),
  // NEAR Intents 1Click, for swaps. Partner key from partners.near-intents.org.
  ONECLICK_API_KEY: z.string().default(""),
  ONECLICK_BASE_URL: z.string().url().default("https://1click.chaindefuser.com"),
  // Swaps out of Movement: where users' USDCx is received (address only), and
  // the EVM wallet that pays out on Base or funds the onward 1Click swap.
  SWAP_MOVEMENT_ADDRESS: z.string().default(""),
  SWAP_EVM_PRIVATE_KEY: z.string().default(""),

  /**
   * How often the server looks for deposits on its own, in minutes, so a
   * closed app still gets "Crypto Received" and a correctly dated record.
   * 0 turns it off. See lib/deposit-watcher.ts.
   */
  DEPOSIT_WATCH_MINUTES: z.coerce.number().min(0).default(3),

  NGN_FUND_MARKUP: z.coerce.number().default(65),
  NGN_SELL_MARKUP: z.coerce.number().default(32.5),

  /**
   * The most either side may ever post, whatever the feed does.
   *
   * The markups above are added to a number this desk does not control. A bad
   * tick, a thin market or a wrong CoinGecko print carries straight through to
   * what we pay for crypto and what we charge for it, and the first anyone
   * would know is the payouts. These are the stop.
   *
   * They bind: past the ceiling the posted rate stops tracking the feed and
   * sits still, so a sell above a feed of ₦1,357.5 is priced at the ceiling
   * rather than at the market. That is the trade - a rate that lags beats a
   * rate that runs away - and the cap has to be raised deliberately when the
   * market has genuinely moved. Zero disables a side.
   */
  NGN_SELL_MAX: z.coerce.number().default(1390),
  NGN_FUND_MAX: z.coerce.number().default(1450),

  // Didit (identity verification / KYC). Optional so a missing key never blocks
  // boot; KYC endpoints report clearly when it is not configured. The API key is
  // SECRET and must only ever live here on the server, never in the app bundle.
  DIDIT_API_KEY: z.string().optional(),
  DIDIT_WORKFLOW_ID: z.string().optional(),
  DIDIT_BASE_URL: z.string().url().default("https://verification.didit.me"),
  // Where Didit sends the user back to when the hosted flow finishes.
  // Must match a real Expo Router route: "money-moves://kyc" resolved to /kyc,
  // which does not exist, so the deep-link handoff back from Didit misfired.
  DIDIT_CALLBACK_URL: z.string().default("money-moves://account/kyc"),

  // Treasury wallets (private keys for sending crypto to users after Paystack payment)
  MOVEMENT_TREASURY_PRIVATE_KEY: z.string().min(1),
  MOVEMENT_TREASURY_ADDRESS: z.string().min(1),
  /**
   * The voucher float, kept apart from the treasury above.
   *
   * Optional, unlike the others: a server with no voucher wallet simply has
   * vouchers turned off, and must still boot. Required here would mean every
   * deploy of anything needed a giveaway wallet to exist.
   */
  VOUCHER_TREASURY_PRIVATE_KEY: z.string().default(""),
  VOUCHER_TREASURY_ADDRESS: z.string().default(""),

  /**
   * A wallet of its own for money that belongs to users.
   *
   * Never the treasury above. That one holds what we chose to give away; this
   * one holds somebody else's USDC until it is claimed or sent back, and the
   * balance here is what reconciliation is checked against. Unset means users
   * cannot create vouchers - it must never fall back to the treasury.
   */
  VOUCHER_ESCROW_PRIVATE_KEY: z.string().default(""),
  VOUCHER_ESCROW_ADDRESS: z.string().default(""),
  EVM_TREASURY_PRIVATE_KEY: z.string().min(1),
  SOLANA_TREASURY_PRIVATE_KEY: z.string().min(1),

  // Gasless fee-payer (separate from funding treasury)
  SOLANA_GASLESS_PRIVATE_KEY: z.string().min(1),
  EVM_GAS_SPONSOR_PRIVATE_KEY: z.string().min(1),

  // Sell treasury wallets (receive crypto when users sell/offramp)
  SELL_EVM_ADDRESS: z.string().min(1),
  SELL_MOVEMENT_ADDRESS: z.string().min(1),
  SELL_SOLANA_ADDRESS: z.string().min(1),
  /**
   * Where USDT sold on TON is received.
   *
   * There is no matching treasury key, because nothing sends USDT on TON from
   * our side: buying is an on-ramp and that lands on Movement. This chain is
   * off-ramp and transfers only, so the address is somewhere money arrives.
   *
   * Optional, unlike its siblings: a server without it must still boot, and
   * selling on TON is refused rather than half-working.
   */
  SELL_TON_ADDRESS: z.string().default(""),

  /**
   * Stellar. One treasury key does three jobs: it pays every fee (by wrapping
   * the user's transaction in a fee bump), it sponsors the reserve that opening
   * an account and each trustline locks up, and it is where sold and bill USDC
   * and USDT0 arrive. Users never hold XLM.
   *
   * Optional, like TON: a server without it boots, and Stellar is refused
   * rather than half-working.
   */
  STELLAR_TREASURY_SECRET: z.string().default(""),
  /** PUBLIC for mainnet, TESTNET for the self-test. */
  STELLAR_NETWORK: z.enum(["PUBLIC", "TESTNET"]).default("PUBLIC"),
  /** Blank picks SDF's public Horizon for the network above. */
  STELLAR_HORIZON_URL: z.string().default(""),
  /** Overrides for testnet only; mainnet uses Circle's USDC and USDT0. */
  STELLAR_USDC_ISSUER: z.string().default(""),
  STELLAR_USDT_ISSUER: z.string().default(""),
  /** Where sold and bill Stellar coins land. Blank means the treasury itself. */
  SELL_STELLAR_ADDRESS: z.string().default(""),

  // HMAC secret for signed sell quotes. Falls back to JWT_ACCESS_SECRET if unset.
  SELL_QUOTE_SECRET: z.string().min(32).optional(),

  // Google Gemini (OCR for account-number scanning) — optional
  GEMINI_API_KEY: z.string().optional(),

  // VTU.ng (airtime & data)
  VTU_EMAIL: z.string().min(1),
  VTU_PASSWORD: z.string().min(1),
  VTU_USER_PIN: z.string().min(1),

  // Admin — comma-separated list of allowed admin emails, set on Railway (never in the code).
  // Unset: nobody can sign in to the admin console, and the rest of the app carries on.
  ADMIN_EMAIL: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0)
    ),

  // Shared admin password — required (with a valid admin email) before an admin
  // login OTP is ever sent. Stops bots from spamming the login endpoint and
  // exhausting our email quota. Set this in Railway and share with admins.
  ADMIN_PASSWORD: z.string().optional(),

  // Hash of the password the admin page asks for before a naira rate changes or
  // an account is closed (make it with src/scripts/action-password-hash.ts).
  // Unset = both locked.
  ADMIN_ACTION_PASSWORD_HASH: z.string().optional(),

  // App-review accounts (comma-separated) — skip the login email OTP. Set on Railway; unset, there are none.
  REVIEW_EMAILS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0)
    ),

  // Extra disposable/blocked email domains for registration (comma-separated).
  // Merged with the built-in blocklist in lib/disposable-domains.ts.
  BLOCKED_EMAIL_DOMAINS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0)
    ),

  // Email configuration
  ENABLE_TRANSACTIONAL_EMAILS: z
    .string()
    .default("true")
    .transform((s) => s.trim().toLowerCase() === "true"),

  /**
   * Force a payout rail, over whatever the console says.
   *
   * Break-glass, like the maintenance flags below: the switch itself lives in
   * the database, and this is the way to move it when the database is what is
   * broken. Unset in normal operation.
   */
  PAYOUT_PROVIDER: z.string().optional(),

  // Maintenance flags — set to "true" to disable a feature without redeploying clients
  BANK_TRANSFER_MAINTENANCE: z
    .string()
    .default("false")
    .transform((s) => s.trim().toLowerCase() === "true"),
  FUNDING_MAINTENANCE: z
    .string()
    .default("false")
    .transform((s) => s.trim().toLowerCase() === "true"),
  // Per-token funding maintenance — set to "true" to block only that token
  USDT_FUNDING_MAINTENANCE: z
    .string()
    .default("false")
    .transform((s) => s.trim().toLowerCase() === "true"),
  SOL_FUNDING_MAINTENANCE: z
    .string()
    .default("false")
    .transform((s) => s.trim().toLowerCase() === "true"),
  USDC_BASE_FUNDING_MAINTENANCE: z
    .string()
    .default("false")
    .transform((s) => s.trim().toLowerCase() === "true"),
  USDC_SOL_FUNDING_MAINTENANCE: z
    .string()
    .default("false")
    .transform((s) => s.trim().toLowerCase() === "true"),
  AIRTIME_MAINTENANCE: z
    .string()
    .default("false")
    .transform((s) => s.trim().toLowerCase() === "true"),
  ELECTRICITY_MAINTENANCE: z
    .string()
    .default("false")
    .transform((s) => s.trim().toLowerCase() === "true"),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
