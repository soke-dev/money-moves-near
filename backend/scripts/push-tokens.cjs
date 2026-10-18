/**
 * Who has a push token on file, and who does not.
 *
 * A registered token is the only proof the device got far enough to talk to
 * APNs or FCM. An account that signs in on Android and still shows no token
 * never reached FCM at all, which points at the build rather than at
 * preferences or at the server.
 *
 *   railway run --service backend node scripts/push-tokens.cjs [email]
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const EMAIL = process.argv[2] || null;

async function main() {
  const where = EMAIL ? { user: { email: { equals: EMAIL, mode: "insensitive" } } } : {};

  const rows = await prisma.notificationPrefs.findMany({
    where,
    select: {
      expoPushToken: true,
      pushEnabled: true,
      txAlerts: true,
      securityAlerts: true,
      user: { select: { email: true, username: true } },
    },
  });

  if (EMAIL) {
    if (!rows.length) {
      console.log(`No notification_prefs row for ${EMAIL} - the app has never registered a token.`);
      return;
    }
    for (const r of rows) {
      console.log(`${r.user.email} (@${r.user.username || "no username"})`);
      console.log(`  token:    ${r.expoPushToken || "NONE"}`);
      console.log(`  push:     ${r.pushEnabled ? "on" : "OFF"}`);
      console.log(`  tx:       ${r.txAlerts ? "on" : "OFF"}`);
      console.log(`  security: ${r.securityAlerts ? "on" : "OFF"}`);
    }
    return;
  }

  const withToken = rows.filter((r) => !!r.expoPushToken);
  const disabled = rows.filter((r) => !r.pushEnabled);
  const users = await prisma.user.count();

  console.log(`accounts:              ${users}`);
  console.log(`prefs rows:            ${rows.length}`);
  console.log(`with a push token:     ${withToken.length}`);
  console.log(`push switched off:     ${disabled.length}`);
  console.log("");
  for (const r of withToken.slice(0, 20)) {
    console.log(`  ${r.user.email.padEnd(34)} ${r.expoPushToken}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
