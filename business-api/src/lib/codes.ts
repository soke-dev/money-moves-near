/**
 * Six-digit email codes: issuing one, and checking one exactly once.
 *
 * A challenge lasts ten minutes and five wrong tries. Issuing a new one ends
 * any older one of the same kind, so only the latest email works. Using one is
 * a single conditional update, so two requests racing with the right code
 * can't both get in.
 */
import { randomUUID } from "crypto";
import type { CodePurpose } from "@prisma/client";
import { prisma } from "./prisma";
import { hashCode, newCode, sameHex } from "./crypto";
import { codeEmail, sendEmail } from "./email";

const MINUTES = 10;
const TRIES = 5;

export async function issueCode(user: { id: string; email: string }, purpose: CodePurpose) {
  await prisma.loginCode.updateMany({ where: { userId: user.id, purpose, usedAt: null }, data: { usedAt: new Date() } });
  const id = randomUUID();
  const code = newCode();
  await prisma.loginCode.create({
    data: { id, userId: user.id, purpose, codeHash: hashCode(code, id), expiresAt: new Date(Date.now() + MINUTES * 60_000) },
  });
  const mail = codeEmail(purpose, code);
  await sendEmail(user.email, mail.subject, mail.text, { html: mail.html });
  return id;
}

/**
 * A challenge for someone who doesn't exist: same shape, never verifies. It
 * keeps "is this email registered?" from being answerable by asking.
 */
export const decoyChallenge = () => randomUUID();

export type CodeCheck = { ok: true; userId: string } | { ok: false; reason: "expired" | "wrong" | "too_many" };

export async function checkCode(challengeId: string, code: string, purpose: CodePurpose): Promise<CodeCheck> {
  const row = await prisma.loginCode.findUnique({ where: { id: challengeId } }).catch(() => null);
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) return { ok: false, reason: "expired" };
  if (row.attempts >= TRIES) return { ok: false, reason: "too_many" };
  if (!/^\d{6}$/.test(code) || !sameHex(row.codeHash, hashCode(code, row.id))) {
    await prisma.loginCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, reason: row.attempts + 1 >= TRIES ? "too_many" : "wrong" };
  }
  const used = await prisma.loginCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count === 0) return { ok: false, reason: "expired" };
  return { ok: true, userId: row.userId };
}

export const CODE_ERRORS: Record<"expired" | "wrong" | "too_many", string> = {
  expired: "That code has expired. Ask for a new one.",
  wrong: "That code isn't right. Check the latest email and try again.",
  too_many: "Too many wrong tries. Ask for a new code.",
};
