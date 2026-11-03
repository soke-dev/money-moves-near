import express from "express";
import path from "path";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import waitlistRoutes from "./routes/waitlist";
import { createHash } from "crypto";
import { env } from "./config/env";
import { reconcilePendingBachPayouts } from "./lib/bach";
import { isStableyardConfigured } from "./lib/stableyard";
import { isDiditConfigured } from "./lib/didit";
import { isVoucherEscrowConfigured } from "./lib/voucher-escrow";
import { sweepRefunds } from "./lib/user-voucher";
import { sweepWaitingDidit } from "./routes/kyc";
import {
  syncInFlightRoutedDeposits,
  discoverRoutedDeposits,
} from "./lib/stableyard-ledger";
import { isAuroraConfigured, isSwapConfigured } from "./lib/aurora";
import { syncInFlightAuroraDeposits, discoverAuroraDeposits, watchAuroraAddresses } from "./lib/aurora-deposits";
import { refreshInFlightSwaps } from "./lib/aurora-swap";
import swapRoutes from "./routes/swap";
import { prisma } from "./lib/prisma";
import { extractClientInfo } from "./middleware/auth";
import { errorHandler } from "./middleware/error";
import authRoutes from "./routes/auth";
import walletRoutes from "./routes/wallet";
import transactionRoutes from "./routes/transactions";
import savingsRoutes from "./routes/savings";
import userRoutes from "./routes/user";
import beneficiaryRoutes from "./routes/beneficiaries";
import cryptoContactRoutes from "./routes/crypto-contacts";
import ratesRoutes from "./routes/rates";
import kycRoutes from "./routes/kyc";
import identityHandoffRoutes from "./routes/identity-handoff";
import adminRoutes from "./routes/admin";
import fundingRoutes from "./routes/funding";
import routedDepositRoutes from "./routes/routed-deposits";
import statementRoutes from "./routes/statement";
import voucherRoutes from "./routes/vouchers";
import notificationRoutes from "./routes/notifications";
import { internalRouter as businessLinksInternal, userRouter as businessLinksRoutes } from "./routes/business-links";
import { internalRouter as businessPaymentsInternal, userRouter as businessPaymentsRoutes } from "./routes/business-payments";
import billsRoutes from "./routes/bills";
import chatRoutes from "./routes/chat";
import leaderboardRoutes from "./routes/leaderboard";
import ocrRoutes from "./routes/ocr";
import intentsRoutes from "./routes/intents";
import statusRoutes from "./routes/status";
import { appVersionGate } from "./middleware/app-version";
import { startDepositWatcher } from "./lib/deposit-watcher";

// ─── Catch unhandled errors so the process doesn't crash ────
process.on("unhandledRejection", (reason, promise) => {
  console.error("⚠️  Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("⚠️  Uncaught Exception:", err);
});

const app = express();

// A brotli-compressed request body is refused before anything unpacks it.
// Nothing we serve sends one, and Node's brotli decoder had a remote code
// execution bug (CVE-2026-111497, fixed in Node 22.23.4). Responses can still
// be compressed; this is only about what comes in.
app.use((req, res, next) => {
  const encoding = String(req.headers["content-encoding"] ?? "").toLowerCase();
  if (encoding.split(",").some((e) => e.trim() === "br")) {
    res.status(415).json({ error: "Send the request body uncompressed.", code: "unsupported_encoding" });
    return;
  }
  next();
});

// ─── Serve uploaded files ───────────────────────────────────
// UPLOADS_DIR lets Railway (or any host with ephemeral FS) point this at a
// persistent volume so avatars don't vanish on deploy/restart.
const uploadsRoot = process.env.UPLOADS_DIR || path.join(__dirname, "../uploads");
app.use(
  "/uploads",
  (_req, res, next) => {
    // Images are fetched from the web app on a different origin — opt into
    // cross-origin loads so Helmet/COEP defaults don't block them.
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(uploadsRoot)
);

// ─── Security Headers ───────────────────────────────────────
app.use(helmet());

// ─── CORS ───────────────────────────────────────────────────
const allowedOrigins = [
  env.FRONTEND_URL,
  "https://usemoneymoves.xyz",
  "https://app.usemoneymoves.xyz",
  "https://web.usemoneymoves.xyz",
  "https://moneymovesmobile.netlify.app",
  // The Business dashboard serves the page app users take a manual identity check on.
  "https://business.usemoneymoves.xyz",
  "http://localhost:8081",
];
app.use(
  cors({
    origin: env.NODE_ENV === "production"
      ? (origin, callback) => {
          // Allow requests with no origin (mobile apps, curl, etc.)
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            callback(null, false);
          }
        }
      : true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ─── Body Parsing ───────────────────────────────────────────
// The raw bytes are stashed on the request because webhook signatures are an
// HMAC over exactly what was sent: re-serialising req.body reorders keys and
// changes whitespace, and the digest stops matching.
app.use(
  express.json({
    limit: "10kb", // Prevent large payload attacks
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

// ─── Client Info Extraction ─────────────────────────────────
app.use(extractClientInfo);

// ─── Rate Limiting ──────────────────────────────────────────
/**
 * Global ceiling, counted per signed-in device rather than per IP.
 *
 * Two things were wrong with 100 per IP per 15 minutes.
 *
 * The app polls balances every 15 seconds while it is open - 60 requests in
 * the window before anything the user actually does - so a normal session ran
 * out of budget and whichever call came next got a 429. That is how a working
 * savings screen ended up reporting a failure.
 *
 * And a phone on mobile data shares its IP with everyone else behind that
 * carrier NAT, so one busy user could throttle strangers. The key is the
 * bearer token when there is one, so each device gets its own allowance, and
 * the IP only when there is not.
 */
const deviceKey = (req: express.Request): string => {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    // Hashed, so tokens are not held in the limiter's memory.
    return "t:" + createHash("sha1").update(auth.slice(7)).digest("hex").slice(0, 24);
  }
  return "ip:" + (req.ip ?? "unknown");
};

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  keyGenerator: deviceKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

// Auth-specific: stricter limits for login/register
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts, please try again later" },
});

// Registration: much stricter than login to curb scripted fake sign-ups.
// A real person creates one account; a bot tries many.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sign-up attempts. Please try again later." },
});

/**
 * PIN-specific: strict, but only about getting it WRONG.
 *
 * `skipSuccessfulRequests` is what makes the limit mean "ten wrong guesses"
 * rather than "ten PIN prompts". Every transaction verifies a PIN, so counting
 * correct ones locked people out of their own money after ten payments.
 */
const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many PIN attempts, please try again later" },
});

/**
 * Swap prices. Each one is a call to the swap provider, whose rate limit is
 * shared by everybody, so one device asking nonstop could stop swaps for all.
 * Thirty a minute is far above what the screen asks while somebody types.
 */
const swapQuoteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: deviceKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many price checks. Wait a moment and try again." },
});

// Refresh token: prevent token farming
const refreshLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many refresh attempts, please try again later" },
});

/**
 * One hop, not blind trust.
 *
 * Railway terminates TLS and forwards, so without this every request keys to
 * the proxy's address and the rate limiters become one shared bucket for the
 * whole app - ten PIN attempts per fifteen minutes across every user on every
 * device. `true` would be worse than useless: it lets a client set its own
 * X-Forwarded-For and walk past the limiter entirely.
 */
app.set("trust proxy", 1);

/**
 * Counts which app versions are calling, and - once MIN_APP_VERSION (or its
 * _IOS / _ANDROID form) is set - declines the ones that say they are older.
 * A request with no version always passes: webhooks and the admin console
 * send none. Unset today.
 */
app.use("/api/", appVersionGate);
app.use("/api/", globalLimiter);
/**
 * The waitlist is open to anyone, so it gets its own leash.
 *
 * Nothing here is expensive and nothing is emailed, but a public write is a
 * public write: five a minute from one address is plenty for a person and
 * uninteresting to anybody filling a table for sport.
 */
const waitlistLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in a minute." },
});
app.use("/api/waitlist", waitlistLimiter);

/**
 * The referral-code check is open to people not yet signed in, so it gets a
 * ceiling of its own. Generous enough for somebody fixing a typo a few times,
 * nowhere near enough to walk a code space - and codes are six random hex
 * digits, so there is no pattern to walk anyway.
 */
const referralCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  keyGenerator: deviceKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many tries. Wait a few minutes and try again." },
});
app.use("/api/auth/referral", referralCheckLimiter);
app.use("/api/auth/register", registerLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/dynamic", authLimiter);
app.use("/api/auth/pin", pinLimiter);
app.use("/api/auth/refresh", refreshLimiter);
app.use("/api/auth/password/reset-request", authLimiter);
app.use("/api/auth/password/reset-confirm", authLimiter);



// ─── Health Check ───────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Routes ─────────────────────────────────────────────────
app.use("/api/waitlist", waitlistRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/statement", statementRoutes);
app.use("/api/vouchers", voucherRoutes);
app.use("/api/savings", savingsRoutes);
app.use("/api/user", userRoutes);
app.use("/api/beneficiaries", beneficiaryRoutes);
app.use("/api/crypto-contacts", cryptoContactRoutes);
app.use("/api/rates", ratesRoutes);
app.use("/api/kyc", kycRoutes);
// The page a manual identity check is taken on; the link's code is its only key.
app.use("/api/identity-handoff", identityHandoffRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/funding", fundingRoutes);
app.use("/api/routed-deposits", routedDepositRoutes);
app.use("/api/swap/quote", swapQuoteLimiter);
app.use("/api/swap/prepare", swapQuoteLimiter);
app.use("/api/swap", swapRoutes);
app.use("/api/notifications", notificationRoutes);
// Money Moves Business: its requests (signed, internal) and the person's own answers.
app.use("/api/internal/business-links", businessLinksInternal);
app.use("/api/business-links", businessLinksRoutes);
// Its checkouts, paid from the app.
app.use("/api/internal/business-payments", businessPaymentsInternal);
app.use("/api/business-payments", businessPaymentsRoutes);
app.use("/api/bills", billsRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/ocr", ocrRoutes);
app.use("/api/intents", intentsRoutes);
// Public: the app asks this before it has a session.
app.use("/api/status", statusRoutes);

// ─── 404 ────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ─── Global Error Handler ───────────────────────────────────
app.use(errorHandler);

// ─── Start ──────────────────────────────────────────────────
async function main() {
  try {
    // Verify database connection
    await prisma.$connect();
    console.log("✅ Database connected");

    app.listen(env.PORT, () => {
      console.log(`🚀 Money Moves API running on port ${env.PORT}`);
      console.log(`📍 Environment: ${env.NODE_ENV}`);
    });

    // Deposits sent to a closed app: found, dated and notified without it.
    startDepositWatcher();

    // Reconcile pending Bach sell payouts so completed ones flip to COMPLETED
    // even if the client stopped polling the verify endpoint.
    setInterval(() => {
      reconcilePendingBachPayouts().catch(() => {});
    }, 60_000);

    /**
     * Finish routed deposits nobody is watching.
     *
     * The deposit screen syncs whatever it reads, but a Bitcoin conversion
     * takes long enough that the app is usually closed by the time it lands.
     * Without this the row would sit at Processing until somebody happened to
     * open that screen again - and the notification saying it arrived would
     * fire hours late, or never.
     *
     * Costs one provider call per account with something still in flight,
     * which is almost always none.
     */
    if (isStableyardConfigured()) {
      setInterval(() => {
        syncInFlightRoutedDeposits().catch(() => {});
      }, 2 * 60_000);

      /**
       * The slower sweep that FINDS deposits, rather than following ones we
       * already know about.
       *
       * Without it the first sight of a deposit is whenever the person next
       * opens the deposit screen - so somebody who sent and closed the app got
       * no pending row, no "we have seen it", and a transaction that appeared
       * already finished.
       *
       * Runs shortly after boot as well as on the interval, because a deploy
       * is exactly when something can have arrived unwatched.
       */
      setTimeout(() => {
        discoverRoutedDeposits().catch(() => {});
      }, 25_000);
      setInterval(() => {
        discoverRoutedDeposits().catch(() => {});
      }, 5 * 60_000);
    }

    /**
     * Aurora: swaps and BTC / Tron deposits, finished while the app is closed.
     *
     * Swaps in flight are checked every minute - one status read each, and
     * there are rarely any. Deposits already seen are followed every two
     * minutes; finding new ones walks every address on file, so it runs every
     * ten, well inside their hourly limit for the endpoint.
     */
    // Swaps run on whichever provider has a key; deposits are Aurora's alone.
    if (isSwapConfigured()) {
      setInterval(() => {
        refreshInFlightSwaps().catch(() => {});
      }, 60_000);
    }
    if (isAuroraConfigured()) {
      setInterval(() => {
        syncInFlightAuroraDeposits().catch(() => {});
      }, 2 * 60_000);
      // The addresses read off their own chains, so a deposit shows the moment it is broadcast.
      setTimeout(() => {
        watchAuroraAddresses().catch(() => {});
      }, 20_000);
      setInterval(() => {
        watchAuroraAddresses().catch(() => {});
      }, 2 * 60_000);
      setTimeout(() => {
        discoverAuroraDeposits().catch(() => {});
      }, 40_000);
      setInterval(() => {
        discoverAuroraDeposits().catch(() => {});
      }, 10 * 60_000);
    }

    /**
     * Ask Didit about the waiting queue, hourly.
     *
     * A session approved by hand in Didit's console fires no webhook we are
     * subscribed to - that is `data.updated` - so an account decided that way
     * used to sit at Waiting until somebody pressed the button or the person
     * opened the app. Neither is something to rely on: one is a human
     * remembering, the other is somebody who has been told to wait.
     *
     * An hour, because nothing here is urgent and it costs one provider call
     * per waiting person. An empty queue costs one database read.
     *
     * Runs a little after boot as well, since a deploy is a free chance to
     * catch up on whatever was decided while nothing was listening.
     */
    /**
     * Send back what user vouchers did not give away.
     *
     * Every five minutes, because this is somebody else's money sitting in our
     * wallet after their voucher ended - not a background job that can wait
     * for somebody to notice. It sends to the creator's wallet on file and
     * takes no input at all, so there is nothing here to aim somewhere else.
     *
     * Soon after boot as well: a deploy during a voucher's last minutes should
     * not delay the money going home.
     */
    if (isVoucherEscrowConfigured()) {
      const refunds = () =>
        sweepRefunds()
          .then(({ sent, failed }) => {
            if (sent || failed) {
              console.log(`[ESCROW] refund sweep: ${sent} sent, ${failed} could not be sent`);
            }
          })
          .catch((e: any) => console.error("[ESCROW] refund sweep failed:", e?.message));

      setTimeout(refunds, 45_000);
      setInterval(refunds, 5 * 60_000);
    }

    if (isDiditConfigured) {
      const sweep = () =>
        sweepWaitingDidit()
          .then(({ checked, changed, unchanged, failed }) => {
            if (checked) {
              console.log(
                `[KYC] hourly sweep: ${checked} asked, ${changed.length} decided, ` +
                  `${unchanged} still waiting, ${failed} could not be read`,
              );
            }
          })
          .catch((e: any) => console.error("[KYC] hourly sweep failed:", e?.message));

      setTimeout(sweep, 90_000);
      setInterval(sweep, 60 * 60_000);
    }
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down...");
  await prisma.$disconnect();
  process.exit(0);
});

main();
