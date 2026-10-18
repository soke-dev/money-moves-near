import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { validate } from "../middleware/validate";
import { isDisposableEmailDomain } from "../lib/disposable-domains";

/**
 * waitlist.ts — people waiting for the business product.
 *
 * Open to the world, because it sits on the marketing site and there is
 * nobody to authenticate. That shapes everything here: it stores one string,
 * sends nothing, and says nothing back that could be used to find out who
 * else has signed up.
 *
 * Deliberately NOT an email trigger. Somebody joining a waitlist for a thing
 * that does not exist yet has not asked to be written to, and a confirmation
 * mail is the sort of thing that gets a young domain listed as a spammer.
 * The list is here when there is something to say.
 */
const router = Router();

const joinSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

router.post("/", validate(joinSchema), async (req: Request, res: Response) => {
  try {
    const email = String(req.body.email).trim().toLowerCase();

    if (isDisposableEmailDomain(email)) {
      res.status(400).json({ error: "Please use a permanent email address." });
      return;
    }

    /**
     * The unique index decides, not a read.
     *
     * Checking first and inserting second is two queries with a gap between
     * them, and two taps on a slow connection land in that gap - so both see
     * nothing, both insert, and one gets a constraint error anyway. Insert
     * first and let P2002 mean "already there", which is a fact the database
     * establishes rather than one this code hopes is still true.
     */
    try {
      await prisma.waitlistEntry.create({ data: { email, source: "business" } });
      console.log(`[WAITLIST] joined: ${email}`);
      res.json({ status: "added" });
    } catch (err: any) {
      if (err?.code === "P2002") {
        res.json({ status: "already" });
        return;
      }
      throw err;
    }
  } catch (err: any) {
    console.error("[WAITLIST] failed:", err?.message);
    res.status(500).json({ error: "Could not add you just now. Try again shortly." });
  }
});

export default router;
