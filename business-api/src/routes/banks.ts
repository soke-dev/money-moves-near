/**
 * Bank accounts a business is paid to (Payout places).
 *
 * Up to five. Each is looked up with the bank when it's added, and the name
 * the bank gives is compared with the business's - the registered name, or
 * for a "Just me" account the person's own. Only an account that matches can
 * be settled to; one that doesn't waits for a person to check it. The first
 * matching account becomes the default.
 */
import { Router } from "express";
import { z } from "zod";
import type { BankAccount } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { limited } from "../lib/limits";
import { namesMatch } from "../lib/names";
import { nameOnRecord } from "../lib/banks";
import { requireMember, requireUser } from "../middleware/auth";
import { lookupRails } from "../rails";

export const MAX_BANKS = 5;
/** Where the money goes is the owner's alone: only they add, change or remove a bank account. */
const MANAGE = ["OWNER"] as const;

/** Every lookup is a call to the bank rail: a few a minute is plenty for a person adding an account. */
const lookups = limited(40);

const accountInput = z.object({
  bankCode: z.string().trim().min(2, "Choose your bank.").max(12),
  accountNumber: z.string().trim().regex(/^\d{10}$/, "An account number is 10 digits."),
});

export const bankShape = (b: BankAccount) => ({
  id: b.id,
  bankCode: b.bankCode,
  bankName: b.bankName,
  accountNumber: b.accountNumber,
  accountName: b.accountName,
  nameMatches: b.nameMatches,
  /** Our team looked at it and said no. */
  declined: !b.nameMatches && !!b.reviewedAt,
  isDefault: b.isDefault,
  createdAt: b.createdAt,
});

const listFor = (businessId: string) => prisma.bankAccount.findMany({ where: { businessId, removedAt: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });

async function lookUp(businessId: string, bankCode: string, accountNumber: string) {
  const rails = lookupRails();
  const bank = (await rails.banks()).find((x) => x.code === bankCode);
  if (!bank) throw new HttpError(400, "Choose your bank from the list.", "unknown_bank");
  const expected = await nameOnRecord(businessId);
  const r = await rails.resolve(bankCode, accountNumber, expected);
  if (!r.ok) throw new HttpError(400, r.reason, "account_not_found");
  return { bank, accountName: r.accountName, nameMatches: namesMatch(r.accountName, expected), expected };
}

// ─── /api/banks ───────────────────────────────────────────────────────────

export const banksRouter = Router();

banksRouter.get("/", requireUser, async (_req, res) => {
  res.json({ banks: await lookupRails().banks() });
});

// ─── /api/businesses/:businessId/bank-accounts ────────────────────────────

export const bankAccountsRouter = Router({ mergeParams: true });

bankAccountsRouter.get("/", requireMember(), async (req, res) => {
  res.json({ bankAccounts: (await listFor(req.member!.businessId)).map(bankShape), max: MAX_BANKS });
});

/** Whose account it is, before it's saved - the form shows the name as the number is typed. */
bankAccountsRouter.post("/resolve", requireMember(...MANAGE), lookups, async (req, res) => {
  const b = body(accountInput, req);
  const r = await lookUp(req.member!.businessId, b.bankCode, b.accountNumber);
  res.json({ bankName: r.bank.name, accountName: r.accountName, nameMatches: r.nameMatches });
});

bankAccountsRouter.post("/", requireMember(...MANAGE), lookups, async (req, res) => {
  const businessId = req.member!.businessId;
  const b = body(accountInput, req);
  const list = await listFor(businessId);
  if (list.length >= MAX_BANKS) throw new HttpError(400, `That's the most you can add (${MAX_BANKS}). Remove one to add another.`, "too_many");
  if (list.some((x) => x.bankCode === b.bankCode && x.accountNumber === b.accountNumber)) throw new HttpError(409, "That account is already here.", "duplicate");
  const r = await lookUp(businessId, b.bankCode, b.accountNumber);
  const hasDefault = list.some((x) => x.isDefault && x.nameMatches);
  const saved = await prisma.bankAccount.create({
    data: { businessId, bankCode: b.bankCode, bankName: r.bank.name, accountNumber: b.accountNumber, accountName: r.accountName, nameMatches: r.nameMatches, isDefault: r.nameMatches && !hasDefault },
  });
  await audit(req, "bank_account_added", { businessId, detail: { bankAccountId: saved.id, bank: r.bank.name, last4: b.accountNumber.slice(-4), nameMatches: r.nameMatches } });
  res.status(201).json({ bankAccount: bankShape(saved), bankAccounts: (await listFor(businessId)).map(bankShape) });
});

bankAccountsRouter.post("/:bankId/default", requireMember(...MANAGE), async (req, res) => {
  const businessId = req.member!.businessId;
  const target = await prisma.bankAccount.findFirst({ where: { id: String(req.params.bankId), businessId, removedAt: null } });
  if (!target) throw new HttpError(404, "That account isn't here any more.", "not_found");
  if (!target.nameMatches) throw new HttpError(400, "Only a checked account can be the default.", "not_checked");
  await prisma.$transaction([
    prisma.bankAccount.updateMany({ where: { businessId, isDefault: true }, data: { isDefault: false } }),
    prisma.bankAccount.update({ where: { id: target.id }, data: { isDefault: true } }),
  ]);
  await audit(req, "bank_account_default", { businessId, detail: { bankAccountId: target.id } });
  res.json({ bankAccounts: (await listFor(businessId)).map(bankShape) });
});

/** Removed, not deleted: past settlements still say where they went. Links set to it fall back to the default. */
bankAccountsRouter.delete("/:bankId", requireMember(...MANAGE), async (req, res) => {
  const businessId = req.member!.businessId;
  const target = await prisma.bankAccount.findFirst({ where: { id: String(req.params.bankId), businessId, removedAt: null } });
  if (!target) throw new HttpError(404, "That account isn't here any more.", "not_found");
  await prisma.bankAccount.update({ where: { id: target.id }, data: { removedAt: new Date(), isDefault: false } });
  if (target.isDefault) {
    const next = await prisma.bankAccount.findFirst({ where: { businessId, removedAt: null, nameMatches: true }, orderBy: { createdAt: "asc" } });
    if (next) await prisma.bankAccount.update({ where: { id: next.id }, data: { isDefault: true } });
  }
  await audit(req, "bank_account_removed", { businessId, detail: { bankAccountId: target.id } });
  res.json({ bankAccounts: (await listFor(businessId)).map(bankShape) });
});
