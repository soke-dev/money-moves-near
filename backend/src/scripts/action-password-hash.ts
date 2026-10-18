/**
 * Make the hash for ADMIN_ACTION_PASSWORD_HASH, the password the admin page
 * asks for before a naira rate changes or an account is closed (see
 * lib/action-password.ts).
 *
 *   npx tsx src/scripts/action-password-hash.ts
 *
 * Asks for the password without echoing it, so it never lands in shell
 * history, and prints only the hash. Paste that into Railway; to change the
 * password later, run this again and replace the variable.
 */
import readline from "readline";
import { hashActionPassword } from "../lib/action-password";

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  (rl as any)._writeToOutput = (s: string) => {
    if (!muted) process.stdout.write(s);
  };
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const pw = await ask("Action password: ");
  if (pw.length < 8) throw new Error("Use at least 8 characters.");
  if ((await ask("Again: ")) !== pw) throw new Error("Those did not match.");
  console.log(`\nADMIN_ACTION_PASSWORD_HASH=${await hashActionPassword(pw)}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
