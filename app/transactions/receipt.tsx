import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  StatusBar,
  Image,
  Share,
  Clipboard,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Sharing from "expo-sharing";
import ViewShot from "react-native-view-shot";
import { File as FsFile, Paths } from "expo-file-system";
import { buildImagePdf } from "@/services/receipt-pdf";
import { AppStoreBadge, GooglePlayBadge } from "@/components/StoreBadges";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { getTransaction } from "@/services/transactions";
import { assetLabel, SELL_FEE_RATE, splitSellFee } from "@/constants/transfer";

const fmtNaira = (n: number) =>
  "₦" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ReceiptScreen() {
  const colors = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { id, done } = useLocalSearchParams<{ id: string; done?: string }>();

  /**
   * Where closing goes.
   *
   * Opened from a finished purchase, the screen beneath is the form that made
   * it - going "back" there offers to do the whole thing again. `done` says
   * the flow is over, so the way out is home.
   */
  const close = () => {
    if (done === "1") router.replace("/(tabs)" as any);
    else if (navigation.canGoBack()) router.back();
    else router.replace("/(tabs)" as any);
  };
  const { transactions } = useApp();
  const receiptShotRef = useRef<any>(null);
  /**
   * A fullScreenModal on Android is its own window, and that window is not
   * always handed the safe-area insets - useSafeAreaInsets can answer 0, which
   * put the close button underneath the status bar with no way to reach it.
   * StatusBar.currentHeight is measured from the window that actually exists,
   * so it is the floor here.
   */
  const topPad =
    Platform.OS === "web"
      ? 67
      : Platform.OS === "android"
      ? Math.max(insets.top, StatusBar.currentHeight ?? 24) + 20
      : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const localTx = transactions.find((t) => t.id === id);
  const [remoteTx, setRemoteTx] = useState<any>(null);
  const [fetchingTx, setFetchingTx] = useState(!localTx);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const { transaction } = await getTransaction(id);
        if (!cancelled) setRemoteTx(transaction);
      } catch {}
      if (!cancelled) setFetchingTx(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Prefer remote (has metadata) over local
  const tx = remoteTx || localTx;

  if (fetchingTx) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={close}>
            <Feather name="x" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.foreground }]}>Receipt</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={s.empty}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!tx) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={close}>
            <Feather name="x" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.foreground }]}>Receipt</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={s.empty}>
          <Text style={{ color: colors.mutedForeground, fontSize: 16, fontFamily: "Inter_400Regular" }}>
            Transaction not found
          </Text>
        </View>
      </View>
    );
  }

  const isCryptoTransfer = tx.type === "TRANSFER";

  // Extract real tx hash and data from metadata
  const meta: any = tx.metadata || {};
  const txHash = meta.txHash || null;
  const walletAddress = meta.walletAddress || null;
  const amountNaira = meta.amountNaira || meta.ngnNet || meta.nairaAmount || null;
  const rawFee = meta.feeNaira ?? meta.ngnFee ?? (meta.ngnGross != null && meta.ngnNet != null ? Math.round(Number(meta.ngnGross) - Number(meta.ngnNet)) : null);
  const feeNaira = rawFee != null && !isNaN(Number(rawFee)) ? Number(rawFee) : null;
  const feePercent = meta.feePercent || (tx.type === "SELL" ? "0.5" : null);
  const liveRateNgn = meta.liveRateNgn || meta.ngnRate || null;

  // Truncate long addresses/hashes
  const truncate = (s: string) => s.length > 12 ? s.slice(0, 5) + "..." + s.slice(-5) : s;

  // Build explorer URL based on chain
  const getExplorerUrl = (hash: string, chain: string | null): string | null => {
    if (!hash) return null;
    switch (chain) {
      case "MOVE": return `https://explorer.movementnetwork.xyz/txn/${hash}`;
      case "BASE": return `https://basescan.org/tx/${hash}`;
      case "BEP20": return `https://bscscan.com/tx/${hash}`;
      case "ARB": return `https://arbiscan.io/tx/${hash}`;
      case "ARC": return `https://explorer.arc.io/tx/${hash}`;
      // An event id, not a transaction hash: one jetton transfer is
      // several transactions and tonviewer is what groups them.
      case "TON": return `https://tonviewer.com/transaction/${hash}`;
      case "SOL": return `https://solscan.io/tx/${hash}`;
      case "STELLAR": return `https://stellar.expert/explorer/public/tx/${hash}`;
      case "MONAD": return `https://monadscan.com/tx/${hash}`;
      default: return null;
    }
  };
  const explorerUrl = txHash ? getExplorerUrl(txHash, tx.chain) : null;

  const isInternalTransfer = tx.type === "TRANSFER_OUT" || tx.type === "TRANSFER_IN";
  const transferUsername = meta.recipientUsername || meta.senderUsername || null;

  const getTypeLabel = () => {
    switch (tx.type) {
      case "BUY": return "Fund Wallet";
      case "SELL": return "Bank Transfer";
      case "DEPOSIT": return "Deposit";
      case "TRANSFER": return "Crypto Transfer";
      case "WITHDRAW": return meta.payee ? `Paid ${meta.payee}` : "Crypto Withdrawal";
      case "LOCK":
      case "SAVINGS_LOCK": return "Savings Lock";
      case "UNLOCK":
      case "SAVINGS_WITHDRAW": return "Savings Withdrawal";
      case "TRANSFER_OUT": return "Sent to User";
      case "TRANSFER_IN": return "Received from User";
      case "AIRTIME": return meta.billType === "electricity" ? "Electricity Purchase" : meta.billType === "betting" ? "Betting Top-up" : meta.billType === "data" ? "Data Purchase" : "Airtime Purchase";
      default: return tx.type;
    }
  };

  const getBadgeLabel = () => {
    switch (tx.type) {
      case "TRANSFER": return "Crypto";
      case "DEPOSIT": return "Crypto";
      case "BUY": return "Fund";
      case "SELL": return "Transfer";
      case "WITHDRAW": return meta.payee ? "Business payment" : "Withdrawal";
      case "TRANSFER_OUT": return "Sent";
      case "TRANSFER_IN": return "Received";
      case "LOCK":
      case "SAVINGS_LOCK": return "Locked";
      case "UNLOCK":
      case "SAVINGS_WITHDRAW": return "Unlocked";
      case "AIRTIME": return meta.billType === "electricity" ? "Electricity" : meta.billType === "betting" ? "Betting" : meta.billType === "data" ? "Data" : "Airtime";
      default: return tx.type;
    }
  };

  const userName = "Money Moves User";

  const txHashDisplay = txHash ? truncate(txHash) : undefined;

  const txDate = new Date(tx.createdAt);

  /** "11 Sep 2026  ·  1:36pm" */
  const stampedAt = (() => {
    const d = txDate;
    if (isNaN(d.getTime())) return "";
    const month = d.toLocaleDateString("en-GB", { month: "short" });
    const time = d
      .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      .replace(/\s+/g, "")
      .toLowerCase();
    return `${d.getDate()} ${month} ${d.getFullYear()}  ·  ${time}`;
  })();

  const maskAcct = (n: string) => n.length >= 6 ? n.slice(0, 3) + "**" + n.slice(-3) : n;

  const assetText = assetLabel(tx.asset);
  type ReceiptRow = { label: string; value: string };
  const rows: ReceiptRow[] = [
    { label: "Type", value: getTypeLabel() },
    ...(transferUsername ? [{ label: tx.type === "TRANSFER_OUT" ? "Sent to" : "Received from", value: `@${transferUsername}` }] : []),
    ...(meta.phone ? [{ label: meta.billType === "electricity" ? "Meter Number" : meta.billType === "betting" ? "Account ID" : "Phone Number", value: meta.phone }] : []),
    ...((meta.billType === "electricity" || meta.billType === "betting") && meta.customerName ? [{ label: meta.billType === "betting" ? "Account Name" : "Customer Name", value: meta.customerName }] : []),
    ...(meta.network ? [{ label: meta.billType === "electricity" ? "Biller" : meta.billType === "betting" ? "Bookmaker" : "Network", value: meta.disco || meta.network }] : []),
    ...(meta.billType === "electricity" && meta.meterType ? [{ label: "Meter Type", value: meta.meterType === "prepaid" ? "Prepaid" : "Postpaid" }] : []),
    ...(meta.planLabel ? [{ label: "Plan", value: meta.planLabel }] : []),
    ...((meta.billType === "electricity" && (meta.electricityToken || meta.vtuResult?.recharge_token || meta.vtuResult?.data?.token || meta.vtuResult?.token || meta.vtuResult?.data?.purchased_code || meta.vtuResult?.purchased_code)) ? [{ label: "Electricity Token", value: meta.electricityToken || meta.vtuResult?.recharge_token || meta.vtuResult?.data?.token || meta.vtuResult?.token || meta.vtuResult?.data?.purchased_code || meta.vtuResult?.purchased_code }] : []),
    ...((meta.billType === "electricity" && (meta.electricityUnits || meta.vtuResult?.data?.units || meta.vtuResult?.units)) ? [{ label: "Units", value: meta.electricityUnits || meta.vtuResult?.data?.units || meta.vtuResult?.units }] : []),
    ...(meta.bankName ? [{ label: "Bank", value: meta.bankName }] : []),
    ...(meta.accountName ? [{ label: "Account Name", value: meta.accountName }] : []),
    ...(meta.accountNumber ? [{ label: "Account Number", value: maskAcct(meta.accountNumber) }] : []),
    ...(walletAddress && tx.type !== "SELL" ? [{ label: "Receiving Wallet", value: truncate(walletAddress) }] : []),
    ...(!isInternalTransfer && tx.type !== "SELL" && feeNaira != null
      ? tx.type === "SELL"
        ? [
            { label: `Platform fee (${(SELL_FEE_RATE * 100).toFixed(1)}%)`, value: fmtNaira(splitSellFee(Number(feeNaira)).platform) },
            { label: "Processing fee", value: fmtNaira(splitSellFee(Number(feeNaira)).processing) },
          ]
        : [{ label: "Fee", value: `${fmtNaira(feeNaira)}${feePercent ? ` (${feePercent}%)` : ""}` }]
      : []),
    ...(tx.reference ? [{ label: "Reference", value: tx.reference }] : []),
    ...(meta.narration ? [{ label: isInternalTransfer ? "Note" : "Narration", value: meta.narration }] : []),
    ...(txHashDisplay && tx.type !== "SELL" ? [{ label: "Transaction Hash", value: txHashDisplay }] : []),
  ];

  const buildReceiptText = () => [
    `--- Money Moves Receipt ---`,
    ``,
    `Amount: ${tx.type === "SELL" && amountNaira ? fmtNaira(amountNaira) : `${Number(tx.amount).toFixed(tx.asset === "ETH" ? 8 : 4)} ${assetText}`}`,
    `Date: ${txDate.toLocaleDateString()} ${txDate.toLocaleTimeString()}`,
    ``,
    ...rows.map((r) => `${r.label}: ${r.value}`),
    ``,
    `Status: ${tx.status}`,
    `--- End of Receipt ---`,
  ].join("\n");

  const handleShare = async () => {
    if (Platform.OS === "web") {
      const fileName = `money-moves-receipt-${tx.id || Date.now()}.jpg`;
      const text = buildReceiptText();
      const nav: any = typeof navigator !== "undefined" ? navigator : null;

      let dataUrl: string | undefined;
      try {
        const shot: string | undefined = await receiptShotRef.current?.capture?.();
        dataUrl = shot && !shot.startsWith("data:") ? `data:image/jpeg;base64,${shot}` : shot;
      } catch (err) {
        console.warn("[receipt] capture failed:", err);
      }

      if (dataUrl) {
        try {
          const blob = await (await fetch(dataUrl)).blob();
          const file = new File([blob], fileName, { type: "image/jpeg" });
          if (nav?.canShare?.({ files: [file] }) && typeof nav.share === "function") {
            await nav.share({ files: [file], title: "Money Moves Receipt" });
            return;
          }
        } catch (err: any) {
          if (err?.name === "AbortError") return;
          console.warn("[receipt] image share failed:", err);
        }

        try {
          const link = document.createElement("a");
          link.href = dataUrl;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          return;
        } catch (err) {
          console.warn("[receipt] image download failed:", err);
        }
      }

      try {
        if (typeof nav?.share === "function") {
          await nav.share({ title: "Money Moves Receipt", text });
          return;
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
      }

      try {
        await nav?.clipboard?.writeText?.(text);
        if (typeof window !== "undefined") window.alert("Receipt copied to clipboard");
      } catch {
        if (typeof window !== "undefined") window.alert(text);
      }
      return;
    }

    /**
     * A receipt leaves as a PDF.
     *
     * An image is something you took a picture of; a PDF is a document. People
     * forward these to landlords, employers and support desks, and half of
     * those want a file they can attach rather than a screenshot.
     *
     * JPEG rather than PNG for the capture, because JPEG is a filter PDF
     * understands natively - the bytes go straight into the file with no
     * re-encoding.
     */
    try {
      const base64 = await receiptShotRef.current?.capture?.();
      if (!base64 || !(await Sharing.isAvailableAsync())) {
        await Share.share({ message: buildReceiptText() });
        return;
      }

      const name = `money-moves-receipt-${tx.reference || tx.id}`.replace(/[^a-zA-Z0-9_-]/g, "-");
      const file = new FsFile(Paths.cache, `${name}.pdf`);
      if (file.exists) file.delete();
      file.create();
      file.write(buildImagePdf(base64));

      await Sharing.shareAsync(file.uri, {
        mimeType: "application/pdf",
        dialogTitle: "Share receipt",
        UTI: "com.adobe.pdf",
      });
    } catch (err) {
      // Anything at all goes wrong and they still get the details as text,
      // rather than a share button that does nothing.
      console.warn("[RECEIPT] PDF share failed, sending text instead:", err);
      Share.share({ message: buildReceiptText() }).catch(() => {});
    }
  };

  // Card colors: dark card regardless of theme for receipt feel
  /**
   * Paper on a dark field.
   *
   * A receipt is the one screen people screenshot and pass on, so it is built
   * to travel: the card is white whatever the app's theme, and the field behind
   * it is fixed near-black rather than the brand lime. White on lime is two
   * light surfaces with nothing between them - the paper has to sit on
   * something dark to read as paper at all.
   */
  const PAPER = "#ffffff";
  const INK = "#0d0d0d";
  const INK_MUTED = "#8a8a8f";
  const HAIRLINE = "#ebebef";
  const HASH_GREY = "#6e6e75";
  const FIELD = "#0B0B0C";
  const NEON = "#81FB02";

  return (
    <View style={[s.container, { backgroundColor: FIELD, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => {
            close();
          }}
          hitSlop={12}
        >
          <Feather name="x" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: bottomPad + 130 }]}
        showsVerticalScrollIndicator={false}
      >
        <ViewShot
          ref={receiptShotRef}
          options={{ format: "jpg", quality: 0.94, result: "base64" }}
        >
          <View style={{ backgroundColor: FIELD, paddingBottom: 4 }}>
            {/* Masthead sits on the field, not the paper: it is who issued the
                receipt rather than part of what the receipt says. */}
            <View style={s.masthead}>
              <Image
                source={require("@/assets/images/logo-lockup.png")}
                style={s.lockup}
                resizeMode="contain"
              />
              <Text style={[s.mastheadTitle, { color: "#fff" }]}>Transaction Receipt</Text>
            </View>

            <View style={[s.paper, { backgroundColor: PAPER }]}>
              <Text style={[s.paperAmount, { color: INK }]}>
                {(tx.type === "SELL" || tx.type === "AIRTIME") && amountNaira
                  ? fmtNaira(amountNaira)
                  : `${Number(tx.amount).toFixed(tx.asset === "ETH" ? 8 : 4)} ${assetText}`}
              </Text>

              {/* When it happened, read together with how much. */}
              <Text style={[s.receiptDate, { color: INK_MUTED }]}>{stampedAt}</Text>

              {rows.map((row, i) => (
                <View key={i} style={[s.paperRow, { borderTopColor: HAIRLINE }, i === 0 && s.paperRowFirst]}>
                  <Text style={[s.paperLabel, { color: INK_MUTED }]}>{row.label}</Text>
                  {row.label === "Transaction Hash" && explorerUrl ? (
                    <TouchableOpacity style={s.linkValue} onPress={() => Linking.openURL(explorerUrl)}>
                      <Text style={[s.paperValue, { color: HASH_GREY }]}>{row.value}</Text>
                      <Feather name="external-link" size={12} color={HASH_GREY} />
                    </TouchableOpacity>
                  ) : (
                    <Text style={[s.paperValue, { color: INK }]}>{row.value}</Text>
                  )}
                </View>
              ))}

              <View style={s.supportBox}>
                <Text style={[s.supportText, { color: INK_MUTED }]}>For support and enquiries:</Text>
                <Text
                  style={[s.supportMail, { color: INK }]}
                  onPress={() => Linking.openURL("mailto:support@usemoneymoves.xyz")}
                >
                  support@usemoneymoves.xyz
                </Text>
              </View>
            </View>

            {/* The torn edge: discs of the field colour biting up into the
                paper. Few and large, or it reads as a decorative frill rather
                than a tear. */}
            <View style={s.scallops} pointerEvents="none">
              {Array.from({ length: SCALLOP_COUNT }).map((_, i) => (
                <View key={i} style={[s.scallop, { backgroundColor: FIELD }]} />
              ))}
            </View>

            {/* Inside the capture on purpose. This receipt gets forwarded to
                people who do not have the app, and the tear is exactly where
                their eye already is. */}
            <View style={[s.promo, { backgroundColor: NEON }]}>
              <Text style={[s.promoTitle, { color: "#0a0a0a" }]}>
                The smart way to move money
              </Text>
              <Text style={[s.promoSub, { color: "#0a0a0acc" }]}>
                Spend crypto like cash, pay bills and send naira in seconds.
              </Text>

              <View style={s.storeRow}>
                <AppStoreBadge height={40} />
                <GooglePlayBadge height={40} />
              </View>
            </View>
          </View>
        </ViewShot>
      </ScrollView>

      <View style={[s.shareDock, { backgroundColor: FIELD, paddingBottom: bottomPad + 16 }]}>
        <TouchableOpacity
          style={[s.shareBtn, { backgroundColor: NEON }]}
          onPress={handleShare}
          activeOpacity={0.85}
        >
          <Feather name="share" size={17} color="#0a0a0a" />
          <Text style={[s.shareBtnText, { color: "#0a0a0a" }]}>Share receipt</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Few and wide. Sixteen small bumps read as a frill, not a tear. */
const SCALLOP_COUNT = 11;

const s = StyleSheet.create({
  // Mark on the left, what the document is on the right - the way a letterhead
  // is laid out, and the way the reference does it.
  masthead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 20,
    paddingHorizontal: 2,
  },
  // 1150x164 artwork, so the height follows the width rather than being guessed.
  lockup: { width: 126, height: 18 },
  mastheadTitle: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },

  // No overflow:hidden anywhere above the tear - it clipped the discs into
  // flat bumps, which is what made the edge look like a mistake.
  paper: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 28, paddingBottom: 24 },
  paperAmount: {
    fontSize: 38,
    lineHeight: 46,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -1.4,
    textAlign: "center",
  },
  // Rules go on the top of each row, so the list is separated without a
  // trailing line under the last one.
  paperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  paperRowFirst: { borderTopWidth: 0 },
  paperLabel: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", flexShrink: 0 },
  paperValue: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold", textAlign: "right", flexShrink: 1 },
  linkValue: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },

  supportBox: { backgroundColor: "#f4f4f7", borderRadius: 12, padding: 14, alignItems: "center", marginTop: 26 },
  supportText: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular" },
  supportMail: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold", marginTop: 2 },

  // Pulled up by half a disc so each one bites into the paper rather than
  // sitting under it.
  scallops: { flexDirection: "row", justifyContent: "space-around", marginTop: -14 },
  scallop: { width: 28, height: 28, borderRadius: 14 },

  promo: { borderRadius: 20, padding: 18, marginTop: 16 },
  promoTitle: { fontSize: 21, lineHeight: 27, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.6 },
  promoSub: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_500Medium", marginTop: 5 },
  storeRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 },
  // Not buttons. This block exists to be seen inside a shared screenshot, where
  // nothing is tappable - so it states availability rather than pretending to
  // be a link that does nothing.

  shareDock: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 14 },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 56, borderRadius: 28 },
  shareBtnText: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.2 },

  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  content: { padding: 20, gap: 16 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },

  /* Receipt Card */
  receiptCard: {
    borderRadius: 20, padding: 24, overflow: "hidden",
  },
  receiptTop: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24,
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 32, height: 32, borderRadius: 8 },
  logoText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  typeBadge: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 14 },
  typeBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },

  amountWrap: { alignItems: "center", marginBottom: 20 },
  receiptIconCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 8,
  },
  receiptAmount: { fontSize: 36, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },

  dashedBorder: { borderTopWidth: 1, borderStyle: "dashed" },
  receiptDate: {
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginTop: -3,
    marginBottom: 26,
  },
  receiptRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 14,
  },
  receiptLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  receiptValue: { fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "right", flexShrink: 1 },


  /* Buttons */
  btnRow: { marginTop: 4 },
});
