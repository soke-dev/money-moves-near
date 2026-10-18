import "dotenv/config";
import { prisma } from "../lib/prisma";
import { getPayout, providerOf } from "../lib/payout";

/**
 * What a settled payout actually carries. Read-only.
 *
 * Flutterwave's dashboard shows a "Proof" on a completed transfer - the NIBSS
 * session id a bank will accept as evidence the money moved. We want to show it
 * to the person it belongs to, and guessing the field name from the label is
 * how you ship something that is null for everybody. This prints the whole
 * payload for a real transfer so the key can be read rather than assumed.
 *
 *   npx tsx src/scripts/payout-proof.ts            # most recent completed sell
 *   npx tsx src/scripts/payout-proof.ts <reference>
 */

/**
 * Does the proof ever turn up, on transfers old enough to have settled at
 * NIBSS? Prints the two containers it could plausibly land in, for the last N.
 */
async function scan(n: number) {
  const rows = await prisma.transaction.findMany({
    where: { type: "SELL", status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    take: n,
  });

  for (const tx of rows) {
    const meta = (tx.metadata ?? {}) as any;
    const handle = meta.flwTransferId || meta.payoutReference || tx.reference;
    if (!handle) continue;
    const r = await getPayout(providerOf(meta), String(handle));
    const raw: any = r.raw ?? {};
    console.log(
      `${tx.createdAt.toISOString().slice(0, 16)}  ${String(handle).padEnd(28)} ` +
        `status=${raw.status ?? "?"} ` +
        `payment_information=${JSON.stringify(raw.payment_information ?? null)} ` +
        `extra_information=${JSON.stringify(raw.extra_information ?? null)}`
    );
  }
}

async function main() {
  const wanted = process.argv[2];

  if (wanted === "--scan") {
    await scan(Number(process.argv[3] || 8));
    return;
  }

  const tx = wanted
    ? await prisma.transaction.findFirst({
        where: { type: "SELL", OR: [{ reference: wanted }, { id: wanted }] },
      })
    : await prisma.transaction.findFirst({
        where: { type: "SELL", status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
      });

  if (!tx) {
    console.log("No matching sell found.");
    return;
  }

  const meta = (tx.metadata ?? {}) as any;
  const provider = providerOf(meta);
  const handle =
    meta.flwTransferId || meta.payoutId || meta.transferId || meta.payoutReference || tx.reference;

  console.log(`${tx.reference}  ${tx.status}  ${tx.createdAt.toISOString()}`);
  console.log(`  provider   ${provider}`);
  console.log(`  handle     ${handle}`);
  console.log(`  stored sessionId: ${JSON.stringify(meta.sessionId ?? null)}`);
  console.log("  stored metadata:");
  console.log(JSON.stringify(meta, null, 2));
  console.log("");

  if (!handle) {
    console.log("Nothing to look up with.");
    return;
  }

  const r = await getPayout(provider, String(handle));
  console.log(`  lookup ok=${r.ok} status=${r.status}`);
  console.log("  raw payload:");
  console.log(JSON.stringify(r.raw, null, 2));

  // Anything that looks like a session id, wherever it is hiding.
  const hits: string[] = [];
  const walk = (o: any, path: string) => {
    if (o == null) return;
    if (typeof o === "object") {
      for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
      return;
    }
    const s = String(o);
    if (/^\d{12,}$/.test(s) || /session|proof|nip|nibss/i.test(path)) {
      hits.push(`${path} = ${s}`);
    }
  };
  walk(r.raw, "");
  console.log("\n  candidates:");
  hits.forEach((h) => console.log(`    ${h}`));
  if (!hits.length) console.log("    (none)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
