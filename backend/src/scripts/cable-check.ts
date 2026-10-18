import "dotenv/config";
import { flwCablePackages } from "../lib/flw-bills";
(async () => {
  for (const p of ["DSTV", "GOtv", "StarTimes"]) {
    const items = await flwCablePackages(p);
    console.log(`\n${p} — ${items.length} packages`);
    for (const i of items.slice(0, 8)) console.log(`   ${i.itemCode.padEnd(8)} ${i.name.slice(0, 38).padEnd(38)} NGN ${i.amount}`);
  }
  console.log("");
})();
