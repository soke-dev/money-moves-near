import "dotenv/config";
import { env } from "../config/env";

/**
 * Why a Stableyard credential is being refused, without printing it.
 *
 * A 401 has boring causes far more often than interesting ones: a quote that
 * came along for the ride, trailing whitespace, or a production key being sent
 * to staging. This shows the shape of what we loaded and tries both
 * environments, so the answer does not require pasting a secret anywhere.
 */

const mask = (v: string) =>
  v.length <= 8 ? `${v.length} chars` : `${v.length} chars, ${v.slice(0, 4)}…${v.slice(-3)}`;

async function probe(base: string, id: string, secret: string) {
  try {
    const res = await fetch(`${base}/v2/partners/config`, {
      headers: {
        Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
        "Content-Type": "application/json",
      },
    });
    const text = await res.text();
    const short = text.length > 160 ? text.slice(0, 160) + "…" : text;
    console.log(`  ${String(res.status).padEnd(4)} ${base}`);
    if (!res.ok) console.log(`       ${short}`);
    return res.ok;
  } catch (e: any) {
    console.log(`  ERR  ${base}  ${e?.message}`);
    return false;
  }
}

(async () => {
  const id = env.STABLEYARD_APP_ID;
  const secret = env.STABLEYARD_APP_SECRET;

  console.log("loaded from backend/.env:");
  console.log(`  APP_ID      ${mask(id)}`);
  console.log(`  APP_SECRET  ${mask(secret)}`);

  const oddities: string[] = [];
  for (const [name, v] of [["APP_ID", id], ["APP_SECRET", secret]] as const) {
    if (v !== v.trim()) oddities.push(`${name} has leading/trailing whitespace`);
    if (/^["']|["']$/.test(v)) oddities.push(`${name} is wrapped in quotes`);
    if (/\s/.test(v.trim())) oddities.push(`${name} contains an inner space`);
  }
  console.log(oddities.length ? "\nodd:\n  " + oddities.join("\n  ") : "\nno quoting/whitespace problems");

  const cleanId = id.trim().replace(/^["']|["']$/g, "");
  const cleanSecret = secret.trim().replace(/^["']|["']$/g, "");

  console.log("\nas loaded:");
  await probe("https://staging-api-v2.stableyard.fi", id, secret);
  await probe("https://prod-api.stableyard.fi", id, secret);

  if (cleanId !== id || cleanSecret !== secret) {
    console.log("\ntrimmed/unquoted:");
    await probe("https://staging-api-v2.stableyard.fi", cleanId, cleanSecret);
    await probe("https://prod-api.stableyard.fi", cleanId, cleanSecret);
  }
})();
