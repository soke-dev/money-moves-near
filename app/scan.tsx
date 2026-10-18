import React, { useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { AccountScanner } from "@/components/AccountScanner";
import { lookupUsername } from "@/services/user";
import { isVoucherCode, voucherCodeFrom } from "@/services/voucher";
import { businessCheckoutFrom, businessPayCodeFrom, type CheckoutKind } from "@/services/business-payments";

/**
 * What a scanned code turned out to be.
 *
 * Three kinds share this camera: a bank account number, a Money Moves
 * username, and a merchant code. They are told apart by shape rather than by
 * asking the user to pick a mode first - pointing a camera at a thing and
 * being asked what kind of thing it is defeats the point of scanning.
 */
type Found =
  | { kind: "account"; accountNumber: string; bankName: string | null }
  | { kind: "username"; username: string }
  | { kind: "merchant"; code: string }
  | { kind: "voucher"; code: string }
  | { kind: "pay"; code: string }
  | { kind: "checkout"; checkout: { kind: CheckoutKind; ref: string; url: string } }
  | { kind: "unknown" };

/** Merchant codes are reserved now and issued later. */
const MERCHANT_PREFIX = "mm:merchant:";

function classify(raw: string): Found {
  const data = raw.trim();
  if (!data) return { kind: "unknown" };

  if (data.toLowerCase().startsWith(MERCHANT_PREFIX)) {
    return { kind: "merchant", code: data.slice(MERCHANT_PREFIX.length) };
  }

  // A checkout on Money Moves Business, shown for paying with the app.
  const payCode = businessPayCodeFrom(data);
  if (payCode) return { kind: "pay", code: payCode };

  // A business's poster, payment link or invoice: paid right here in the app, not on the web page.
  const checkout = businessCheckoutFrom(data);
  if (checkout) return { kind: "checkout", checkout };

  // A voucher. Checked before the handle test, which would otherwise have to
  // reason about why MMV-F3NR-HJTQ is not a username.
  if (isVoucherCode(data)) return { kind: "voucher", code: voucherCodeFrom(data) };

  // A link to a profile, whether the app's own scheme or the website.
  const link = data.match(/(?:moneymoves:\/\/u\/|usemoneymoves\.xyz\/u\/)([A-Za-z0-9_]{3,30})/i);
  if (link) return { kind: "username", username: link[1] };

  const digits = data.replace(/[^0-9]/g, "");
  if (/^\d{10}$/.test(digits) && digits === data.replace(/\s/g, "")) {
    return { kind: "account", accountNumber: digits, bankName: null };
  }

  // A bare handle, which is what our own username codes carry.
  const handle = data.replace(/^@/, "");
  if (/^[A-Za-z0-9_]{3,30}$/.test(handle)) return { kind: "username", username: handle };

  return { kind: "unknown" };
}

export default function ScanScreen() {
  const router = useRouter();
  const colors = useColors();
  const { user } = useApp();
  const [checking, setChecking] = useState(false);

  const toBankTransfer = (accountNumber: string, bankName: string | null) => {
    router.replace({
      pathname: "/sell",
      params: { scanAccount: accountNumber, ...(bankName ? { scanBank: bankName } : {}) },
    });
  };

  const toUsername = async (username: string) => {
    // Your own code is the most likely thing to be pointed at first, and the
    // lookup answers that with a 400 the same shape as "no such user".
    if (user?.username && username.toLowerCase() === user.username.toLowerCase()) {
      Alert.alert("That is your code", "Show it to someone else and they can send to you.", [
        { text: "OK", onPress: () => router.back() },
      ]);
      return;
    }

    setChecking(true);
    try {
      // Resolved here rather than on the next screen: a code for a handle that
      // no longer exists should fail at the camera, not halfway into a send.
      const found = await lookupUsername(username);
      router.replace({
        pathname: "/username-send",
        params: {
          recipientId: found.id,
          recipientUsername: found.username,
          recipientName:
            [found.firstName, found.lastName].filter(Boolean).join(" ") || found.username,
        },
      });
    } catch (e: any) {
      setChecking(false);

      /**
       * Only say the user does not exist when the server said so.
       *
       * A request that never reached the server - no connection, or a session
       * that could not be refreshed - rejects with a plain Error carrying no
       * response. Reading that as "no such user" told people a perfectly real
       * account was missing, which is worse than saying nothing.
       */
      const status = e?.response?.status;
      const reason = e?.response?.data?.error;

      if (status === 404) {
        Alert.alert("No such user", `We could not find @${username} on Money Moves.`);
      } else if (reason) {
        Alert.alert("Cannot send to this code", reason);
      } else {
        Alert.alert(
          "Could not check that code",
          "We could not reach Money Moves just now. Check your connection and try again.",
        );
      }
    }
  };

  /** A checkout's code: the pay screen takes it on and shows who and how much. */
  const toBusinessPayment = (code: string) => {
    router.replace({ pathname: "/business-pay", params: { code } } as any);
  };

  const handleCode = (data: string) => {
    const found = classify(data);

    switch (found.kind) {
      case "account":
        toBankTransfer(found.accountNumber, found.bankName);
        return;
      case "username":
        toUsername(found.username);
        return;
      case "pay":
        toBusinessPayment(found.code);
        return;
      case "checkout":
        router.replace({ pathname: "/business-checkout", params: found.checkout } as any);
        return;
      case "voucher":
        /**
         * Straight to the claim, no confirmation.
         *
         * Pointing a camera at a voucher is the decision; asking again after
         * it has been read is asking somebody to agree to something good.
         * The claim screen owns the waiting, the confetti and the refusal, so
         * this hands over rather than building a second copy of all three -
         * and `scanned` is what keeps the code off every screen that follows.
         */
        router.replace({
          pathname: "/voucher",
          params: { code: found.code, scanned: "1" },
        } as any);
        return;
      case "merchant":
        // Left in deliberately: the codes exist before the flow does, and a
        // scan that says "not yet" is better than one that says nothing.
        Alert.alert("Merchant payments", "Paying merchants by code is not switched on yet.", [
          { text: "OK", onPress: () => router.back() },
        ]);
        return;
      default:
        Alert.alert("We cannot read that", "It is not a Money Moves QR code or a bank account number.", [
          { text: "OK", onPress: () => router.back() },
        ]);
    }
  };

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <AccountScanner
        visible
        title="Scan & pay"
        hint="Scan a Money Moves QR code. To read a bank account number instead, line it up and tap."
        onClose={() => router.back()}
        onCode={handleCode}
        onPick={(account) => toBankTransfer(account.accountNumber, account.bankName)}
      />

      {checking && (
        <View style={s.busy}>
          <ActivityIndicator color="#fff" />
          <Text style={s.busyText}>Looking them up…</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  busy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  busyText: { color: "#fff", fontSize: 14, fontFamily: "Inter_500Medium" },
});
