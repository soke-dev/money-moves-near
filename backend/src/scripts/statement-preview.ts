import "dotenv/config";
import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";
import { buildStatement, type StatementType } from "../lib/statement";
import { renderStatementPdf, statementFilename } from "../lib/statement-pdf";

/**
 * Render one person's statement to a file. Read-only: nothing is emailed and
 * nothing is written to the database.
 *
 *   npx tsx src/scripts/statement-preview.ts <user> [days] [TYPE,TYPE]
 */
async function main() {
  const who = process.argv[2];
  if (!who) {
    console.log("Usage: statement-preview.ts <username|email> [days] [TYPE,TYPE]");
    return;
  }
  const days = Number(process.argv[3] || 90);
  const types = process.argv[4]
    ? (process.argv[4].split(",").map((t) => t.trim().toUpperCase()) as StatementType[])
    : null;

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: who.replace(/^@/, "") }, { email: who }] },
    select: { id: true, username: true },
  });
  if (!user) { console.log("No such user."); return; }

  const to = new Date();
  const from = new Date(to.getTime() - days * 864e5);
  from.setHours(0, 0, 0, 0);

  console.time("build");
  const s = await buildStatement(user.id, from, to, types);
  console.timeEnd("build");
  console.log(`${s.rows.length} rows  ·  in \u20a6${s.totals.inNgn.toFixed(2)}  out \u20a6${s.totals.outNgn.toFixed(2)}`);
  console.log(`estimated rows: ${s.rows.filter((r) => r.estimated).length}`);
  console.log(`categories: ${s.categories.map((c) => `${c.label}(${c.count})`).join(", ")}`);

  console.time("render");
  const pdf = await renderStatementPdf(s);
  console.timeEnd("render");

  const out = path.join(process.cwd(), statementFilename(s));
  fs.writeFileSync(out, pdf);
  console.log(`\n${(pdf.length / 1024).toFixed(0)} KB \u2192 ${out}`);
}

main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
