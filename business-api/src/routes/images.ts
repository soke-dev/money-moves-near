/**
 * Logos and photos, to anyone who has the link - they're on public checkouts.
 * Served with a type we read ourselves and nothing that could run.
 */
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http";

const router = Router();

router.get("/:id", async (req, res) => {
  const img = await prisma.image.findUnique({ where: { id: String(req.params.id) } });
  if (!img) throw new HttpError(404, "Nothing here.", "not_found");
  res.set({
    "Content-Type": img.mime,
    "Content-Length": String(img.size),
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
  res.end(Buffer.from(img.data));
});

export default router;
