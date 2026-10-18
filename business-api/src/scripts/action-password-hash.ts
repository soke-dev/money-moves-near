/**
 * Make the hash for ADMIN_ACTION_PASSWORD_HASH - the password the admin console
 * asks for before a business is deactivated or verified, its name or fee changes,
 * a payout is approved or moved by hand, or Services is saved (see lib/admin.ts).
 *
 *   npm run action-password-hash
 *
 * Asks for the password twice without echoing it, so it never lands in shell
 * history, and prints the hash. Needs no database and no .env. The format is
 * the app's own, so the same password can unlock both.
 *
 * To set it on Railway without the hash ever showing on screen, the :raw
 * script (--raw) prints the hash alone; the questions go to the screen, not
 * the pipe:
 *
 *   npm run -s action-password-hash:raw | railway variable set ADMIN_ACTION_PASSWORD_HASH --stdin --service business-api --environment staging
 */
import readline from "readline";
import { hashActionPassword } from "../lib/action-password";

async function main() {
  const raw = process.argv.includes("--raw");
  // The questions go to stderr, so with --raw nothing but the hash reaches stdout.
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: !!process.stdin.isTTY });
  // What's typed is never echoed.
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
  // Lines are queued as they come: piped in, both can arrive before the second question is asked.
  const lines: string[] = [];
  const waiting: ((line: string | null) => void)[] = [];
  rl.on("line", (line) => {
    const take = waiting.shift();
    if (take) take(line);
    else lines.push(line);
  });
  rl.on("close", () => {
    for (const take of waiting.splice(0)) take(null);
  });
  const ask = (prompt: string) =>
    new Promise<string>((resolve, reject) => {
      process.stderr.write(prompt);
      const answer = (line: string | null) => {
        process.stderr.write("\n");
        if (line == null) reject(new Error("No password given."));
        else resolve(line);
      };
      const queued = lines.shift();
      if (queued !== undefined) answer(queued);
      else waiting.push(answer);
    });
  try {
    const pw = await ask("Action password: ");
    if (pw.length < 8) throw new Error("Use at least 8 characters.");
    if ((await ask("Again: ")) !== pw) throw new Error("Those did not match.");
    const hash = await hashActionPassword(pw);
    if (raw) process.stdout.write(hash);
    else console.log(`\nADMIN_ACTION_PASSWORD_HASH=${hash}\n\nTo set it on staging without it showing anywhere, run this instead:\n  npm run -s action-password-hash:raw | railway variable set ADMIN_ACTION_PASSWORD_HASH --stdin --service business-api --environment staging`);
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
