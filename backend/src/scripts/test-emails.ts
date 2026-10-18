/**
 * Send all 3 redesigned emails to a test address.
 * Usage: npx ts-node src/scripts/test-emails.ts
 */
import "dotenv/config";
import {
  sendVerificationEmail,
  sendWelcomeEmail,
  sendLoginAlertEmail,
} from "../lib/email";

const TO: string = process.argv[2] || process.env.TEST_EMAIL_TO || "";
if (!TO) {
  console.error("Pass an address, or set TEST_EMAIL_TO.");
  process.exit(1);
}
const NAME = "Collins";

async function main() {
  console.log("Sending verification email...");
  await sendVerificationEmail(TO, "482916", NAME);
  console.log("✅ Verification email sent");

  console.log("Sending welcome email...");
  await sendWelcomeEmail(TO, NAME);
  console.log("✅ Welcome email sent");

  console.log("Sending login alert email...");
  await sendLoginAlertEmail(TO, "iPhone 15 Pro / iOS 18.1", "105.112.42.87");
  console.log("✅ Login alert email sent");

  console.log("\nAll 3 emails sent to", TO);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
