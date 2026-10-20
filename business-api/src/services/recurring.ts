/**
 * Recurring invoices. An invoice set to repeat is the first of a series: on
 * schedule, a fresh invoice goes out to the same customer with the same items,
 * a new number and a due date the same distance out as the first one's. Each
 * is its own invoice, paid on its own. A series stops on its end date, when
 * the business stops it, or when the first invoice is voided.
 *
 * Invoices in a series that pass their due date unpaid get one reminder by
 * themselves.
 */
import { Prisma, type Invoice, type InvoiceRepeat } from "@prisma/client";
import { randomBytes } from "crypto";
import { prisma } from "../lib/prisma";
import { log } from "../lib/log";
import { sendEmail } from "../lib/email";
import { formatMinor } from "../lib/money";
import { platform } from "../lib/platform";
import { checkoutLink } from "../lib/pay-links";

const DAY = 86_400_000;

/** The next date in the schedule. Months keep the day where they can: the 31st becomes the last day of a shorter month. */
export function advance(from: Date, every: InvoiceRepeat): Date {
  if (every === "WEEKLY") return new Date(from.getTime() + 7 * DAY);
  const months = every === "MONTHLY" ? 1 : every === "QUARTERLY" ? 3 : 12;
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** The next number for this business and mode: INV-0001 and up. */
export async function nextInvoiceNumber(businessId: string, mode: "TEST" | "LIVE", attempt = 0) {
  const last = await prisma.invoice.findFirst({ where: { businessId, mode }, orderBy: { createdAt: "desc" }, select: { number: true } });
  const n = (Number(last?.number.replace(/\D/g, "")) || 0) + 1 + attempt;
  return `INV-${String(n).padStart(4, "0")}`;
}

type Item = { name: string; qty: number; priceMinor: number };

/** Emails an invoice - live invoices only. Says whether it went. */
export async function emailInvoice(inv: Invoice, businessName: string, reminder: boolean, origin?: string) {
  if (inv.mode !== "LIVE") return false;
  const total = formatMinor(inv.amountMinor, inv.currency);
  const due = inv.dueAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
  const lines = ((inv.items as Item[]) ?? []).map((x) => `  ${x.qty} × ${x.name}: ${formatMinor(x.priceMinor * x.qty, inv.currency)}`).join("\n");
  const url = checkoutLink(`i/${inv.token}`, origin);
  return sendEmail(
    inv.customerEmail,
    reminder ? `Reminder: invoice ${inv.number} from ${businessName}` : `Invoice ${inv.number} from ${businessName}`,
    `Hello ${inv.customerName},\n\n${reminder ? `A reminder that ${businessName} is waiting on` : `${businessName} has sent you`} invoice ${inv.number} for ${total}, due ${due}.\n\n${lines}\n\nTotal: ${total}\n${inv.note ? `\n${inv.note}\n` : ""}\nPay it here: ${url}\n\nMoney Moves Business`,
  );
}

/** One series' next invoice: the schedule is claimed first, so two workers can't both send it. */
async function issueNext(series: Invoice & { business: { name: string; status: string } }) {
  const due = series.nextIssueAt!;
  let next: Date | null = advance(due, series.repeatEvery!);
  if (series.repeatUntil && next > series.repeatUntil) next = null;
  const claimed = await prisma.invoice.updateMany({ where: { id: series.id, nextIssueAt: due }, data: { nextIssueAt: next } });
  if (!claimed.count) return;
  // The same time to pay as the first one gave, never less than a day.
  const gap = Math.max(DAY, series.dueAt.getTime() - (series.sentAt ?? series.createdAt).getTime());
  const now = new Date();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const inv = await prisma.invoice.create({
        data: {
          businessId: series.businessId,
          mode: series.mode,
          number: await nextInvoiceNumber(series.businessId, series.mode, attempt),
          token: randomBytes(16).toString("base64url"),
          customerName: series.customerName,
          customerEmail: series.customerEmail,
          currency: series.currency,
          items: series.items as Prisma.InputJsonValue,
          note: series.note,
          amountMinor: series.amountMinor,
          methods: series.methods,
          accept: series.accept ?? Prisma.JsonNull,
          destination: series.destination,
          bankAccountId: series.bankAccountId,
          dueAt: new Date(now.getTime() + gap),
          feePayer: series.feePayer,
          status: "OPEN",
          createdAt: now,
          sentAt: now,
          repeatOfId: series.id,
          createdById: series.createdById,
        },
      });
      await emailInvoice(inv, series.business.name, false);
      await prisma.auditLog.create({ data: { action: "invoice_sent", businessId: series.businessId, detail: { invoiceId: inv.id, number: inv.number, repeatOf: series.number } } }).catch(() => undefined);
      return;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  // Couldn't make it: put the date back, to try again next round.
  await prisma.invoice.updateMany({ where: { id: series.id, nextIssueAt: next }, data: { nextIssueAt: due } });
}

/** The worker's round: series that are due, then one reminder for each overdue invoice in a series. */
export async function runRecurringInvoices() {
  const rules = await platform();
  const due = await prisma.invoice.findMany({
    where: { nextIssueAt: { lte: new Date() }, repeatEvery: { not: null }, status: { not: "VOID" } },
    include: { business: { select: { name: true, status: true } } },
    take: 50,
  });
  for (const s of due) {
    // Live ones wait while invoices are paused or the business isn't verified; they go out as soon as that changes.
    if (s.mode === "LIVE" && (!rules.channels.invoices || s.business.status !== "VERIFIED")) continue;
    await issueNext(s).catch((e) => log.warn("[recurring] couldn't send the next invoice", { invoice: s.number, reason: e instanceof Error ? e.message : String(e) }));
  }
  const overdue = await prisma.invoice.findMany({
    where: { status: "OPEN", mode: "LIVE", dueAt: { lt: new Date() }, remindedAt: null, OR: [{ repeatOfId: { not: null } }, { repeatEvery: { not: null } }] },
    include: { business: { select: { name: true } } },
    take: 50,
  });
  for (const inv of overdue) {
    const marked = await prisma.invoice.updateMany({ where: { id: inv.id, remindedAt: null }, data: { remindedAt: new Date() } });
    if (marked.count) await emailInvoice(inv, inv.business.name, true).catch(() => false);
  }
}
