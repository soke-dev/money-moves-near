/**
 * Money Moves Business API.
 *
 * Its own service with its own database: nothing here reads the Money Moves
 * app's tables or shares its keys. The dashboard reaches it through its own
 * origin (the static host proxies /api here), so the session cookie is
 * first-party and every state-changing request is origin-checked.
 */
import { env, isDev } from "./config/env";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { prisma } from "./lib/prisma";
import { log } from "./lib/log";
import { loadSession } from "./middleware/auth";
import { resolveClientIp } from "./lib/ip";
import { errors, notFound, sameOrigin } from "./middleware/guards";
import authRoutes from "./routes/auth";
import businessRoutes from "./routes/businesses";
import { bankAccountsRouter, banksRouter } from "./routes/banks";
import { invitesRouter, teamRouter } from "./routes/team";
import disputeRoutes from "./routes/disputes";
import reportRoutes from "./routes/reports";
import linkRoutes from "./routes/links";
import moneyRoutes from "./routes/money";
import payRoutes from "./routes/pay";
import invoiceRoutes from "./routes/invoices";
import outletRoutes from "./routes/outlets";
import adminRoutes from "./routes/admin";
import configRoutes from "./routes/config";
import supportRoutes from "./routes/support";
import moneyMovesRoutes from "./routes/money-moves";
import walletRoutes from "./routes/wallet";
import refundRoutes from "./routes/refunds";
import requestRoutes from "./routes/requests";
import detailChangeRoutes from "./routes/detail-changes";
import imageRoutes from "./routes/images";
import appCheckoutRoutes from "./routes/app-checkouts";
import apiKeyRoutes from "./routes/api-keys";
import directRoutes from "./routes/direct";
import v1Routes from "./routes/v1";
import developerRoutes from "./routes/developers";
import { flutterwaveReady } from "./lib/flutterwave";
import applicationRoutes from "./routes/application";
import webhookRoutes from "./routes/webhooks";
import { refreshNetworks } from "./services/crypto-in";
import { startWorker } from "./worker";
import { checkVault } from "./lib/vault";

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

// Behind Railway's edge. The visitor's address is worked out in lib/ip (proxy-aware); this only
// lets Express see that the original request was HTTPS.
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet());
// Only needed when the dashboard runs on another port in development; in production it's same-origin.
app.use(cors({ origin: env.ALLOWED_ORIGINS, credentials: true }));
app.use(resolveClientIp);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(sameOrigin);
app.use(loadSession);

app.get(["/health", "/api/health"], (_req, res) => {
  res.json({ ok: true, service: "business-api", env: env.APP_ENV });
});

// Outside production only: shows a caller the address we see for them, to check the proxy hop.
if (env.APP_ENV !== "production") {
  app.get("/api/_debug/whoami", (req, res) => {
    res.json({ ip: req.clientIp, viaDashboard: req.viaDashboard });
  });
}

app.use("/api/images", imageRoutes);
app.use("/api/internal/app-checkouts", appCheckoutRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/banks", banksRouter);
app.use("/api/businesses/:businessId/bank-accounts", bankAccountsRouter);
app.use("/api/businesses/:businessId/links", linkRoutes);
app.use("/api/businesses/:businessId/invoices", invoiceRoutes);
app.use("/api/businesses/:businessId/outlets", outletRoutes);
app.use("/api/businesses/:businessId/application", applicationRoutes);
app.use("/api/businesses/:businessId/money-moves", moneyMovesRoutes);
app.use("/api/businesses/:businessId/wallet", walletRoutes);
app.use("/api/businesses/:businessId/refunds", refundRoutes);
app.use("/api/businesses/:businessId/requests", requestRoutes);
app.use("/api/businesses/:businessId/details", detailChangeRoutes);
app.use("/api/businesses/:businessId/api-keys", apiKeyRoutes);
app.use("/api/businesses/:businessId/direct", directRoutes);
app.use("/api/businesses/:businessId/developers", developerRoutes);
app.use("/api/businesses/:businessId/team", teamRouter);
app.use("/api/businesses/:businessId/disputes", disputeRoutes);
app.use("/api/businesses/:businessId/reports", reportRoutes);
app.use("/api/businesses/:businessId", moneyRoutes);
app.use("/api/businesses", businessRoutes);
// The customer's checkout: no sign-in.
app.use("/api/pay", payRoutes);
app.use("/api/invites", invitesRouter);
// What's switched on, for the dashboard and the checkout to show.
app.use("/api/config", configRoutes);
app.use("/api/support", supportRoutes);
// The API, for a business's own server.
app.use("/api/v1", v1Routes);
// Outside services telling us something changed (Didit).
app.use("/api/webhooks", webhookRoutes);
// The admin console's Business side: Money Moves admins only (see lib/admin).
app.use("/api/admin", adminRoutes);

app.use(notFound);
app.use(errors);

// Whether bank lookups are on, and against which Flutterwave - yes or no, never the credentials.
const lookups = flutterwaveReady() ? `flutterwave ${/sandbox/.test(env.FLUTTERWAVE_BASE_URL) ? "sandbox" : "live"}` : isDev ? "simulated" : "off";
const server = app.listen(env.PORT, () => log.info(`[business-api] ${env.APP_ENV} on :${env.PORT} · live naira: ${env.NAIRA_RAILS} · bank lookups: ${lookups}`));
const stopWorker = env.RUN_WORKER ? startWorker() : () => {};
// Without the worker here, the checkout still needs to know whether Stellar and TON can be offered.
if (!env.RUN_WORKER) {
  void refreshNetworks();
  setInterval(() => void refreshNetworks(), 120_000).unref();
}
// Can the stored documents still be opened? If not, uploads wait and the admin console says why.
void checkVault();

// A redeploy sends SIGTERM: finish what's in flight, then let go of the database.
const stop = () => {
  stopWorker();
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
