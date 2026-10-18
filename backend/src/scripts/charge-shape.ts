/**
 * What a settled naira collection actually carries, field by field.
 *
 * Read-only. Prints the SHAPE of a real charge - every key path and its type -
 * with values masked, so the payload can be reasoned about without copying a
 * customer's details anywhere. Anything that looks like it names or identifies
 * the sender is printed in full, because that is the question being asked.
 *
 *   npx tsx src/scripts/charge-shape.ts
 */
import { prisma } from "../lib/prisma";
import { flwGetCharge, getFlutterwaveToken, isFlutterwaveConfigured } from "../lib/flutterwave";
import { env } from "../config/env";

/** The module's own request helper is private, so this script has its own. */
async function flwRaw(method: string, path: string): Promise<any> {
  const token = await getFlutterwaveToken();
  const url = `${env.FLUTTERWAVE_BASE_URL.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Trace-Id": crypto.randomUUID(),
    },
  });
  const body = await res.json().catch(() => ({}));
  console.log(`  [raw] ${method} ${path} -> ${res.status}`);
  return body;
}

// Shown in full: this is the point of the exercise.
const SENDER_HINTS =
  /name|originator|sender|payer|debit|account|bank|narration|remark|reference|meta/i;

function walk(value: any, path = ""): string[] {
  const out: string[] = [];
  if (value === null || value === undefined) {
    out.push(`${path.padEnd(52)} ${value === null ? "null" : "undefined"}`);
    return out;
  }
  if (Array.isArray(value)) {
    out.push(`${path.padEnd(52)} array(${value.length})`);
    value.slice(0, 2).forEach((v, i) => out.push(...walk(v, `${path}[${i}]`)));
    return out;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) out.push(...walk(v, path ? `${path}.${k}` : k));
    return out;
  }
  const shown = SENDER_HINTS.test(path)
    ? JSON.stringify(value)
    : typeof value === "string"
    ? `string(${value.length})`
    : typeof value;
  out.push(`${path.padEnd(52)} ${shown}`);
  return out;
}

(async () => {
  if (!isFlutterwaveConfigured()) {
    console.error("Flutterwave is not configured in this environment.");
    process.exit(1);
  }

  const paid = await prisma.fundingIntent.findMany({
    where: { status: "PAID", chargeId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { reference: true, chargeId: true, amountNaira: true, createdAt: true, bankName: true },
  });

  if (!paid.length) {
    console.log("No settled funding intent with a charge id yet — nothing to inspect.");
    return;
  }

  console.log(`settled collections on record: ${paid.length} (showing the most recent)\n`);
  for (const p of paid) {
    console.log(`  ${p.createdAt.toISOString()}  ₦${p.amountNaira}  charge=${p.chargeId}`);
  }

  // Two ways in, because the single-charge endpoint has been flaky: by id, and
  // by our own reference through the list endpoint the verify poll already
  // uses. Whichever answers first is enough to read the shape.
  for (const target of paid) {
    console.log(`\n── ${target.reference} / ${target.chargeId} ──────────────\n`);

    let payload: any = null;
    const byId = await flwGetCharge(target.chargeId!);
    if (byId.ok && byId.data) payload = byId.data;

    if (!payload) {
      const list = await flwRaw("GET", `/charges?reference=${encodeURIComponent(target.reference)}&size=5`);
      const rows = Array.isArray(list.data) ? list.data : [];
      payload = rows.find((c: any) => c?.reference === target.reference) ?? rows[0] ?? null;
    }

    if (!payload) {
      console.log("  no payload from either route — trying the next one");
      continue;
    }
    console.log(walk(payload).join("\n"));
    return;
  }
  console.error("\nFlutterwave would not answer for any of them.");
})()
  .catch((e) => { console.error(e?.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
