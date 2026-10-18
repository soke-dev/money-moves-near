/**
 * Send one of each redesigned email to a real inbox.
 *
 * Usage: npx tsx src/scripts/preview-emails.ts [address]
 *
 * Transactional sends are force-enabled here, so a staging box with the flag
 * off still produces receipts to look at.
 */
import "dotenv/config";

process.env.ENABLE_TRANSACTIONAL_EMAILS = "true";

const TO: string = process.argv[2] || process.env.TEST_EMAIL_TO || "";
if (!TO) {
  console.error("Pass an address, or set TEST_EMAIL_TO.");
  process.exit(1);
}

async function main() {
  const m = await import("../lib/email");
  const now = new Date().toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const jobs: [string, () => Promise<void>][] = [
    ["sign-in code", () => m.sendVerificationEmail(TO, "482916")],
    ["welcome", () => m.sendWelcomeEmail(TO, "Soke")],
    ["new sign-in", () => m.sendLoginAlertEmail(TO, "iPhone 15 · iOS 18", "102.89.34.17")],
    [
      "crypto sent",
      () =>
        m.sendWithdrawalSuccessEmail(TO, {
          amount: "0.2",
          asset: "USDC",
          chain: "MOVE",
          address: "0xdcac4b1f9a7c5e2d8b3f6a1c4e7d9b2a5c8f1e4d6a9b2c5f8e1d4a7b3c6ab838",
          txHash: "0x89b5fd2c7a1e4b8d3f6c9a2e5b8d1f4c7a9e2b5d8f1c4a7e9b2d5f8c1a498e939",
          reference: "WDR-1789087266649-8814290f",
          date: now,
        }),
    ],
    [
      "money in",
      () =>
        m.sendTransferInEmail(TO, {
          amount: "8.50",
          asset: "USDC",
          chain: "MOVE",
          senderUsername: "tobi",
          reference: "TRF-1789102244817-6c21b09e",
          date: now,
        }),
    ],
    [
      "sold to bank",
      () =>
        m.sendSellSuccessEmail(TO, {
          cryptoAmount: "8.12",
          asset: "USDC",
          chain: "MOVE",
          ngnNet: 12450,
          ngnFee: 120.45,
          bankName: "Guaranty Trust Bank",
          accountNumber: "0123456789",
          accountName: "Soke Collins",
          reference: "trx_m8f2k1c4a9b7e3d1",
          date: now,
        }),
    ],
    [
      "electricity token",
      () =>
        m.sendBillSuccessEmail(TO, {
          billType: "electricity",
          amountNaira: 5000,
          cryptoAmount: "3.21",
          asset: "USDC",
          chain: "MOVE",
          phone: "45123456789",
          network: "IKEDC",
          disco: "Ikeja Electric",
          meterType: "Prepaid",
          customerName: "Soke Collins",
          electricityToken: "0192 8374 5601 2938 4756",
          electricityUnits: "142.8",
          reference: "BILL-m8f2k1c4-9b7e3d",
          date: now,
        }),
    ],
  ];

  for (const [name, send] of jobs) {
    await send();
    console.log(`sent: ${name}`);
  }
  console.log(`\nAll ${jobs.length} sent to ${TO}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
