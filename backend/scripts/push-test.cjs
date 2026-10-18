/**
 * Send one push and read the receipt back.
 *
 * A ticket says Expo accepted the message; a RECEIPT says what the phone's
 * own push service did with it, and that is where Android failures actually
 * show up. The one to look for is InvalidCredentials, which means the FCM V1
 * service account key is missing or wrong for this project - the app gets a
 * token, the server sends happily, and nothing ever arrives.
 *
 *   railway run --service backend node scripts/push-test.cjs someone@email.com
 *   node scripts/push-test.cjs "ExponentPushToken[xxxxxxxx]"
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const TARGET = process.argv[2];

const MEANING = {
  DeviceNotRegistered: "The app was uninstalled, or this token is stale. Sign in again to re-register.",
  InvalidCredentials:
    "Expo could not talk to the phone's push service. On Android this is the FCM V1 service account key missing from EAS credentials; on iOS it is the APNs key.",
  MessageTooBig: "The title and body together are over 4KB.",
  MessageRateExceeded: "Too many messages to one device. Back off and retry.",
  MismatchSenderId:
    "The google-services.json in the build belongs to a different Firebase project than the service account key uploaded to EAS.",
};

async function resolveToken() {
  if (!TARGET) throw new Error("Pass an email or an ExponentPushToken.");
  if (TARGET.startsWith("ExponentPushToken")) return TARGET;

  const prefs = await prisma.notificationPrefs.findFirst({
    where: { user: { email: { equals: TARGET, mode: "insensitive" } } },
    select: { expoPushToken: true, pushEnabled: true },
  });
  if (!prefs) throw new Error(`No notification_prefs row for ${TARGET}.`);
  if (!prefs.expoPushToken) throw new Error(`${TARGET} has no push token on file.`);
  if (!prefs.pushEnabled) console.warn("Note: this account has push switched off in the app.");
  return prefs.expoPushToken;
}

async function main() {
  const to = await resolveToken();
  console.log("to:", to);

  const send = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      to,
      title: "Test from Money Moves",
      body: "If you can read this on the lock screen, push is working.",
      sound: "default",
      channelId: "default",
      priority: "high",
      data: { type: "system" },
    }),
  }).then((r) => r.json());

  const ticket = send?.data;
  console.log("ticket:", JSON.stringify(ticket));

  if (!ticket || ticket.status !== "ok") {
    const err = ticket?.details?.error;
    console.log("\nRejected at the ticket stage.");
    if (err) console.log(`${err}: ${MEANING[err] || "See the Expo push docs."}`);
    return;
  }

  // Receipts are not instant. Expo suggests waiting before asking.
  console.log("\nWaiting 6s for the receipt...");
  await new Promise((r) => setTimeout(r, 6000));

  const receipts = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ids: [ticket.id] }),
  }).then((r) => r.json());

  const receipt = receipts?.data?.[ticket.id];
  console.log("receipt:", JSON.stringify(receipt));

  if (!receipt) {
    console.log("\nNo receipt yet. Run again with the same ticket id in a minute.");
    return;
  }
  if (receipt.status === "ok") {
    console.log("\nDelivered to the push service. If the phone shows nothing, check the");
    console.log("channel's importance in Android settings, or Focus mode on iOS.");
    return;
  }
  const err = receipt?.details?.error;
  console.log(`\nFailed: ${err || "unknown"}`);
  if (err && MEANING[err]) console.log(MEANING[err]);
}

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
