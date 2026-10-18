import { Router, Request, Response } from "express";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { buildStatement, type StatementType } from "../lib/statement";
import { renderStatementPdf, statementFilename } from "../lib/statement-pdf";
import { sendStatementEmail } from "../lib/email";

const router = Router();

/**
 * Statements, emailed rather than downloaded.
 *
 * The file goes to the address on the account and nowhere the request can
 * name, so a stolen session cannot be used to post somebody's whole financial
 * history to an attacker's inbox. It is also why there is no download
 * endpoint: a URL that returns a statement is a URL that can leak one.
 */

const TYPES: StatementType[] = [
  "DEPOSIT", "WITHDRAW", "BUY", "SELL", "TRANSFER", "TRANSFER_IN",
  "TRANSFER_OUT", "AIRTIME", "TV", "SWEEP", "LOCK", "UNLOCK",
];

/** A year at a time. Beyond that a render is minutes and a PDF is hundreds of pages. */
const MAX_DAYS = 366;

/**
 * How often one account may ask.
 *
 * Each request is a browser and a few seconds of CPU, so this is the thing
 * standing between a stuck retry loop and the server. Held in memory rather
 * than a table: a restart forgiving somebody their cooldown is not a problem
 * worth a migration.
 */
const COOLDOWN_MS = 60_000;
const DAILY_CAP = 10;
const asked = new Map<string, { last: number; day: string; count: number }>();

function tooSoon(userId: string): string | null {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const rec = asked.get(userId);

  if (!rec || rec.day !== today) {
    asked.set(userId, { last: now, day: today, count: 1 });
    return null;
  }
  if (now - rec.last < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (now - rec.last)) / 1000);
    return `One statement a minute. Try again in ${wait}s.`;
  }
  if (rec.count >= DAILY_CAP) {
    return "That is as many statements as we send in a day. Try again tomorrow.";
  }
  rec.last = now;
  rec.count++;
  return null;
}

/**
 * ─── POST /statement — build it, print it, send it ──
 *
 * Renders before it answers rather than queueing, because somebody who just
 * tapped the button is still holding the phone: a failure they can see and
 * retry beats a success that never arrives. A statement of a year takes a few
 * seconds, which is inside what a request can hold.
 */
router.post("/", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const blocked = tooSoon(userId);
    if (blocked) {
      res.status(429).json({ error: blocked });
      return;
    }

    const from = new Date(String(req.body?.from ?? ""));
    const to = new Date(String(req.body?.to ?? ""));
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      res.status(400).json({ error: "Pick a start and end date." });
      return;
    }
    if (from > to) {
      res.status(400).json({ error: "That period ends before it starts." });
      return;
    }
    // The whole of the last day, not up to midnight at the start of it.
    to.setHours(23, 59, 59, 999);
    from.setHours(0, 0, 0, 0);

    if ((to.getTime() - from.getTime()) / 864e5 > MAX_DAYS) {
      res.status(400).json({ error: "A statement can cover up to a year at a time." });
      return;
    }

    const raw = Array.isArray(req.body?.types) ? req.body.types : null;
    const types: StatementType[] | null = raw
      ? (raw.filter((t: unknown) => TYPES.includes(t as StatementType)) as StatementType[])
      : null;
    // An empty list after filtering means every type they asked for was
    // unknown - which would silently produce an empty statement.
    if (raw && (!types || types.length === 0)) {
      res.status(400).json({ error: "Pick at least one kind of transaction." });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    });
    if (!user?.email) {
      res.status(400).json({ error: "No email address on this account." });
      return;
    }
    /**
     * Unverified addresses do not get statements.
     *
     * This endpoint mails a complete financial history to whatever address the
     * account carries. If nobody has proved they can read that inbox, it is
     * not an address worth sending one to.
     */
    if (!user.emailVerified) {
      res.status(400).json({ error: "Verify your email address first." });
      return;
    }

    const statement = await buildStatement(userId, from, to, types);
    if (statement.rows.length === 0) {
      res.status(400).json({ error: "Nothing happened in that period." });
      return;
    }

    const pdf = await renderStatementPdf(statement);
    await sendStatementEmail(user.email, {
      from: statement.from,
      to: statement.to,
      number: statement.number,
      rows: statement.rows.length,
      filename: statementFilename(statement),
      pdf,
    });

    res.json({
      sent: true,
      // Masked: it is a confirmation that the right inbox was used, not a
      // place to read the address off somebody's screen.
      email: mask(user.email),
      rows: statement.rows.length,
      number: statement.number,
    });
  } catch (err: any) {
    console.error("[STATEMENT] failed:", err?.message);
    res.status(500).json({ error: "Could not build that statement. Try again shortly." });
  }
});

function mask(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  // A fixed three dots, not one per hidden character: the length of somebody's
  // address is not a thing worth leaking, and a row of eleven dots is ugly.
  return `${name.slice(0, 3)}•••@${domain}`;
}

export default router;
