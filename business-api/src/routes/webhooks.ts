/**
 * Calls from outside services. Each names something of ours; we look it up
 * and ask the service ourselves rather than believing what the call says.
 */
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { log } from "../lib/log";
import { limited } from "../lib/limits";
import { diditReady, getDecision } from "../lib/didit";
import { applyDecision } from "../services/application";

const router = Router();

/** Didit: a session changed. Only its id is taken from the call; the decision is read from Didit. */
router.post("/didit", limited(600), async (req, res) => {
  try {
    const sessionId = String(req.body?.session_id ?? req.body?.sessionId ?? req.body?.data?.session_id ?? "");
    const check = sessionId ? await prisma.identityCheck.findUnique({ where: { sessionId } }) : null;
    if (check && diditReady()) await applyDecision(check, await getDecision(sessionId));
  } catch (e) {
    log.warn("[webhooks] didit call failed", { reason: e instanceof Error ? e.message : String(e) });
  }
  // Always 200: a failure on our side shouldn't make Didit hammer us with retries.
  res.json({ received: true });
});

export default router;
