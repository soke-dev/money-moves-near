/**
 * Bank accounts and the name they must be in: the registered business's, or
 * for a "Just me" account the owner's own - which may only be known once their
 * identity check has read it off their ID.
 *
 * When that name changes, the automatic checks run again; an account our team
 * approved by hand stays approved. The default is always a checked, current
 * account, and there is one whenever any account is checked.
 */
import { prisma } from "./prisma";
import { namesMatch } from "./names";

/** The name a bank account has to be in: the registered business's, or the person's own. */
export async function nameOnRecord(businessId: string): Promise<string | null> {
  const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, include: { members: { where: { role: "OWNER" }, include: { user: true }, take: 1 } } });
  if (b.kind === "REGISTERED") return b.name;
  const u = b.members[0]?.user;
  return [u?.firstName, u?.lastName].filter(Boolean).join(" ") || null;
}

export async function keepOneDefault(businessId: string) {
  await prisma.bankAccount.updateMany({ where: { businessId, isDefault: true, OR: [{ nameMatches: false }, { removedAt: { not: null } }] }, data: { isDefault: false } });
  const checked = await prisma.bankAccount.findMany({ where: { businessId, removedAt: null, nameMatches: true }, orderBy: { createdAt: "asc" } });
  if (checked.length && !checked.some((x) => x.isDefault)) await prisma.bankAccount.update({ where: { id: checked[0]!.id }, data: { isDefault: true } });
}

export async function recheckBanks(businessId: string) {
  const expected = await nameOnRecord(businessId);
  const banks = await prisma.bankAccount.findMany({ where: { businessId, removedAt: null, reviewedAt: null } });
  for (const bk of banks) {
    const matches = namesMatch(bk.accountName, expected);
    if (matches !== bk.nameMatches) await prisma.bankAccount.update({ where: { id: bk.id }, data: { nameMatches: matches } });
  }
  await keepOneDefault(businessId);
}
