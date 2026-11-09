/**
 * A checkout opened from inside the Money Moves app.
 *
 * When someone scans a poster or a link's QR with the app's own scanner, the
 * app doesn't open the web page: it asks here what the checkout is (who, what
 * for, a set price or not) and opens an app payment on it for that person. The
 * payment then shows on their phone like any other, and they approve it with
 * their PIN. A phone's own camera still opens the web checkout.
 *
 * Only Money Moves calls this, server to server, with the shared secret; any
 * other caller is told there's nothing here. Every check a web checkout makes
 * is made here too - the same admit(): active, takes the app, the business
 * verified, nothing paused, the amount inside the limits. Live checkouts only:
 * a test checkout never reaches a real phone.
 */
import crypto from "crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { body, HttpError } from "../lib/http";
import { forMode, platform } from "../lib/platform";
import { ngnPerUsd } from "../lib/rates";
import { appPayReady } from "../lib/app-pay";
import { publicImageUrl } from "../lib/images";
import { canSimulate } from "../rails";
import { fromInvoice, fromLink, fromOutlet, type Checkout } from "../services/payments";
import { openLiveAppPayment } from "../services/app-in";
import { limitsNgn, loadInvoice, loadLink, loadOutlet, reusable } from "./pay";

const router = Router();

/** The shared secret, compared in constant time. Anything else looks like a missing route. */
function fromMoneyMoves(req: Request, res: Response, next: NextFunction) {
  const want = env.BUSINESS_LINK_SECRET;
  const got = String(req.headers["x-business-link-secret"] || "");
  if (!want || got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    res.status(404).json({ error: "Nothing here.", code: "not_found" });
    return;
  }
  next();
}
router.use(fromMoneyMoves);

const KINDS = ["link", "outlet", "invoice"] as const;
type Kind = (typeof KINDS)[number];

async function load(kind: Kind, ref: string): Promise<{ c: Checkout; title: string; description: string | null; invoiceId?: string; email?: string | null; name?: string | null; paid?: boolean }> {
  if (kind === "link") {
    const l = await loadLink(ref.toLowerCase());
    return { c: fromLink(l), title: l.name, description: l.description };
  }
  if (kind === "outlet") {
    const o = await loadOutlet(ref.toLowerCase());
    return { c: fromOutlet(o), title: o.name, description: o.location };
  }
  const inv = await loadInvoice(ref);
  return { c: fromInvoice(inv), title: `Invoice ${inv.number}`, description: inv.note, invoiceId: inv.id, email: inv.customerEmail, name: inv.customerName, paid: inv.status === "PAID" };
}

const kindOf = (v: unknown): Kind => {
  if (!KINDS.includes(v as Kind)) throw new HttpError(404, "Nothing here.", "not_found");
  return v as Kind;
};

/** Why the app can't take this one - said in the app, which then offers the web checkout instead. */
async function blocker(x: Awaited<ReturnType<typeof load>>): Promise<{ code: string; message: string } | null> {
  const { c } = x;
  if (c.mode !== "LIVE" || canSimulate(c.mode)) return { code: "test", message: "This is a test checkout. Open it in your browser to try it. Nothing real moves." };
  if (x.paid) return { code: "paid", message: "This invoice has been paid already." };
  if (!c.active) return { code: "closed", message: "This checkout isn't taking payments right now." };
  if (c.business.status !== "VERIFIED") return { code: "closed", message: "This business can't take payments yet." };
  const p = forMode(await platform(), c.mode, c.business);
  if (p.maintenance) return { code: "paused", message: "Payments are paused for a short while for maintenance. Try again soon." };
  if (!c.methods.includes("APP") || !p.methods.app || !appPayReady()) return { code: "no_app", message: `${c.business.name} doesn't take Money Moves on this checkout. Open it in your browser to pay another way.` };
  return null;
}

/** What the checkout is: who, what for, and a set price or a range to type in. */
router.get("/:kind/:ref", async (req, res) => {
  const x = await load(kindOf(req.params.kind), String(req.params.ref));
  const { c } = x;
  const p = forMode(await platform(), c.mode, c.business);
  const stop = await blocker(x);
  res.json({
    checkout: {
      business: { name: c.business.name, logo: publicImageUrl(c.business.logoId) ?? null, verified: c.business.status === "VERIFIED" },
      title: x.title,
      description: x.description,
      currency: c.currency,
      // In the checkout's own money, major units: a set price, or null for the person to type.
      amount: c.amountMinor != null ? c.amountMinor / 100 : null,
      min: c.minMinor != null ? c.minMinor / 100 : null,
      limits: limitsNgn(p, c.business, c.mode, "app"),
      rate: await ngnPerUsd().catch(() => null),
      payable: !stop,
      blocked: stop,
    },
  });
});

/**
 * Opens an app payment on it for the person who scanned it, and gives back
 * the code their app claims it by. An invoice already being paid in the app
 * gives that payment again rather than a second.
 */
router.post("/:kind/:ref/open", async (req, res) => {
  const kind = kindOf(req.params.kind);
  const x = await load(kind, String(req.params.ref));
  const b = body(
    z.object({
      amount: z.number().positive().optional(),
      currency: z.enum(["NGN", "USD"]).optional(),
      email: z.string().trim().toLowerCase().email().max(254).optional(),
      name: z.string().trim().max(80).optional(),
    }),
    req,
  );
  const stop = await blocker(x);
  if (stop) throw new HttpError(409, stop.message, stop.code);
  if (x.c.amountMinor == null && !(b.amount && b.amount > 0)) throw new HttpError(400, "Enter the amount you're paying.", "amount_required");
  if (x.invoiceId) {
    const open = await reusable(x.invoiceId, "APP");
    if (open?.appCode) {
      res.json({ code: open.appCode, ref: open.ref });
      return;
    }
  }
  const payment = await openLiveAppPayment(
    x.c,
    { email: x.email ?? b.email, name: x.name ?? b.name, amount: x.c.amountMinor == null ? b.amount : undefined, currency: x.c.amountMinor == null ? b.currency : undefined },
    x.title,
  );
  if (!payment.appCode) throw new HttpError(502, "Money Moves didn't take the payment just now. Try again in a moment.", "app_error");
  res.status(201).json({ code: payment.appCode, ref: payment.ref });
});

export default router;
