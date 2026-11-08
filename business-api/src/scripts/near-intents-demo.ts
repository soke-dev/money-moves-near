/**
 * NEAR Intents, end to end, with nothing set up: no database, no keys, no money.
 *
 *   cd business-api && npm install && npm run near-demo
 *
 * It asks NEAR Intents (the 1Click API) for the same quotes the live checkout asks for, through the same code
 * (lib/intents.ts), as dry runs: nothing is created and nothing moves. For a $25 checkout it shows what a customer
 * would send in each coin, and how long the swap takes, with the business receiving exactly 25.00 USDC. Then the
 * same for USDC and USDT arriving from other chains (what Services can route through Intents).
 */

// The config module expects these for the API itself; a dry quote never touches either.
process.env.DATABASE_URL ||= "postgresql://demo:demo@localhost:5432/demo";
process.env.CODE_PEPPER ||= "demo-pepper-demo-pepper-demo-pepper-demo";
// Where a swap that can't finish would refund to. Dry quotes create nothing, so any EVM address does.
process.env.INTENTS_ACCOUNT ||= "0x000000000000000000000000000000000000dEaD";

const PRICE_USD = 25;
// Public example recipients: an address made for the payment in real use. Dry quotes never pay them.
const RECIPIENT = { Solana: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", Monad: "0x1111111111111111111111111111111111111112" } as const;

async function main() {
  const { INTENT_COINS, quoteIntent, stableIntentCoin, IntentQuoteError } = await import("../lib/intents");
  const micros = BigInt(PRICE_USD * 1_000_000);
  const deadline = new Date(Date.now() + 30 * 60_000);

  const row = (a: string, b: string, c: string, d: string) => console.log(`${a.padEnd(22)}${b.padEnd(30)}${c.padEnd(16)}${d}`);
  const quote = async (label: string, coin: Parameters<typeof quoteIntent>[0]["coin"], landing: "Solana" | "Monad") => {
    try {
      const q = await quoteIntent({ coin, landing, recipient: RECIPIENT[landing], micros, deadline, feeBps: 0, dry: true });
      row(label, `${Number(Number(q.amountInFormatted).toPrecision(8))} ${coin.symbol}`, q.amountInUsd ? `≈ $${Number(q.amountInUsd).toFixed(2)}` : "", q.timeEstimate ? `~${q.timeEstimate}s` : "");
      return true;
    } catch (e) {
      const why = e instanceof IntentQuoteError ? (e.leastUsd ? `needs a larger payment right now` : e.message.slice(0, 60)) : String(e).slice(0, 60);
      row(label, "not quoted", "", why);
      return false;
    }
  };

  console.log(`\nA $${PRICE_USD} checkout. The business receives exactly ${PRICE_USD}.00 USDC on Solana, whatever the customer pays with.\n`);
  row("Customer pays with", "Customer sends", "Value", "Swap time");
  console.log("-".repeat(80));
  let ok = 0;
  for (const c of INTENT_COINS) if (await quote(`${c.symbol} on ${c.chain}`, c, "Solana")) ok++;

  console.log(`\nUSDC and USDT from other chains, routed through NEAR Intents into USDC on Monad:\n`);
  row("Customer pays with", "Customer sends", "Value", "Swap time");
  console.log("-".repeat(80));
  for (const [coin, net] of [["USDC", "Solana"], ["USDT", "Ethereum"], ["USDC", "Base"], ["USDT", "Arbitrum"], ["USDT", "TON"]] as const) {
    const c = stableIntentCoin(coin, net);
    if (c && (await quote(`${coin} on ${net}`, c, "Monad"))) ok++;
  }

  console.log(`\n${ok} live quotes from NEAR Intents. Nothing was created or sent (dry runs).\n`);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
