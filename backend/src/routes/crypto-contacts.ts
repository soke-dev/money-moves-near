/**
 * Saved wallet addresses, per chain.
 *
 * Recent and Favourites are the same rows read two ways: recency from
 * lastUsedAt, which a completed withdrawal touches, and `favourite` for the
 * ones the user deliberately kept. That means the Recent list fills itself
 * without anyone having to save anything.
 */
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { validate } from "../middleware/validate";

const router = Router();

// Addresses vary wildly by chain (EVM hex, base58, Aptos hex), so the bound is
// generous and the client validates the shape for the chain it is sending on.
const addressField = z.string().min(20).max(128);

const upsertSchema = z.object({
  address: addressField,
  chain: z.string().min(2).max(16),
  label: z.string().max(40).optional(),
  favourite: z.boolean().optional(),
});

const listSchema = z.object({
  favourite: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  chain: z.string().max(16).optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

// ═══════════════════════════════════════════════════════════
// GET /crypto-contacts
// ═══════════════════════════════════════════════════════════
router.get(
  "/",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      // validate() only covers the body, so query params are parsed here -
      // same shape the beneficiaries list uses.
      const parsed = listSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid query params" });
        return;
      }
      const { favourite, chain, limit } = parsed.data;
      const contacts = await prisma.cryptoContact.findMany({
        where: {
          userId: req.user!.userId,
          ...(favourite !== undefined ? { favourite } : {}),
          ...(chain ? { chain } : {}),
        },
        // Most recently used first: that ordering is the Recent tab.
        orderBy: { lastUsedAt: "desc" },
        take: limit,
      });
      res.json({ contacts });
    } catch (err) {
      console.error("List crypto contacts error:", err);
      res.status(500).json({ error: "Failed to load saved addresses" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /crypto-contacts
// Save an address, or update the one already stored for that chain.
// ═══════════════════════════════════════════════════════════
router.post(
  "/",
  requireAuth,
  requireActiveSession,
  validate(upsertSchema),
  async (req: Request, res: Response) => {
    try {
      const { address, chain, label, favourite } = req.body;
      const userId = req.user!.userId;

      // Upsert rather than create: sending to the same address twice is the
      // normal case, and a duplicate-key error is not something the send flow
      // should have to handle.
      const contact = await prisma.cryptoContact.upsert({
        where: { userId_address_chain: { userId, address, chain } },
        create: {
          userId,
          address,
          chain,
          label: label || null,
          favourite: favourite ?? false,
        },
        update: {
          // Only overwrite a label with a real one - re-sending to a saved
          // address should not wipe the name it was saved under.
          ...(label ? { label } : {}),
          ...(favourite !== undefined ? { favourite } : {}),
          lastUsedAt: new Date(),
        },
      });

      res.json({ contact });
    } catch (err) {
      console.error("Save crypto contact error:", err);
      res.status(500).json({ error: "Failed to save address" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// PATCH /crypto-contacts/:id
// ═══════════════════════════════════════════════════════════
router.patch(
  "/:id",
  requireAuth,
  requireActiveSession,
  validate(z.object({ label: z.string().max(40).optional(), favourite: z.boolean().optional() })),
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const existing = await prisma.cryptoContact.findFirst({
        where: { id, userId: req.user!.userId },
      });
      if (!existing) {
        res.status(404).json({ error: "Address not found" });
        return;
      }

      const contact = await prisma.cryptoContact.update({
        where: { id },
        data: {
          ...(req.body.label !== undefined ? { label: req.body.label || null } : {}),
          ...(req.body.favourite !== undefined ? { favourite: req.body.favourite } : {}),
        },
      });
      res.json({ contact });
    } catch (err) {
      console.error("Update crypto contact error:", err);
      res.status(500).json({ error: "Failed to update address" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// DELETE /crypto-contacts/:id
// ═══════════════════════════════════════════════════════════
router.delete(
  "/:id",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const existing = await prisma.cryptoContact.findFirst({
        where: { id, userId: req.user!.userId },
      });
      if (!existing) {
        res.status(404).json({ error: "Address not found" });
        return;
      }
      await prisma.cryptoContact.delete({ where: { id } });
      res.json({ message: "Address removed" });
    } catch (err) {
      console.error("Delete crypto contact error:", err);
      res.status(500).json({ error: "Failed to remove address" });
    }
  }
);

export default router;
