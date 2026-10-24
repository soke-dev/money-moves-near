import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Clipboard,
  Image,
  Animated,
  Easing,
  Linking,
  Modal,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { routedExplorerUrl, ROUTED_CHAIN_NAME } from "@/services/routed-deposits";
import { useApp } from "@/context/AppContext";
import { getTransaction, checkSellStatus } from "@/services/transactions";
import { PROVIDER_LOGOS } from "@/constants/bills";
import { StageTrack, STAGE_DONE, STAGE_PENDING, STAGE_FAILED } from "@/components/StageTrack";
import { Confetti } from "@/components/Confetti";
import { assetLabel, SELL_FEE_RATE, splitSellFee, fmtAsset, FONT_SCALE } from "@/constants/transfer";

const fmtNaira = (n: number) => "₦" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A meter token in fours.
 *
 * Twenty digits in one run is a number nobody can keep their place in while
 * typing it into a keypad on a wall. Grouped only when it is all digits -
 * some discos return a reference with letters in it, and chopping that up
 * would be inventing structure that is not there.
 */
function groupToken(token: string): string {
  const bare = token.replace(/\s+/g, "");
  if (!/^\d{12,}$/.test(bare)) return token;
  return bare.replace(/(\d{4})(?=\d)/g, "$1 ");
}

export default function TransactionDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { transactions, refreshTransactions } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const [copiedField, setCopiedField] = useState("");
  const [showFeeInfo, setShowFeeInfo] = useState(false);

  const localTx = transactions.find((t) => t.id === id);
  const [remoteTx, setRemoteTx] = useState<any>(null);
  const [fetchingTx, setFetchingTx] = useState(!localTx);

  useEffect(() => {
    if (!id) return;
    // Always fetch full detail (with metadata) from API
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

  // Poll sell status if PROCESSING
  useEffect(() => {
    const tx = remoteTx || localTx;
    if (!tx || tx.type !== "SELL" || tx.status !== "PROCESSING") return;
    let cancelled = false;
    const poll = setInterval(async () => {
      try {
        const { status } = await checkSellStatus(tx.id);
        if (!cancelled && status !== "PROCESSING") {
          // Refetch full tx to get updated data
          const { transaction } = await getTransaction(tx.id);
          if (!cancelled) setRemoteTx(transaction);
          // Update global transaction list so list screen reflects new status
          refreshTransactions();
          clearInterval(poll);
        }
      } catch {}
    }, 5000);
    return () => { cancelled = true; clearInterval(poll); };
  }, [remoteTx?.id, remoteTx?.status, localTx?.id, localTx?.status]);

  // Prefer remote (has metadata) over local
  const tx = remoteTx || localTx;


  const handleBack = () => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace("/" as any);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    Clipboard.setString(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(""), 1500);
  };

  if (!tx) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={handleBack}>
            <Feather name="arrow-left" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.foreground }]}>Transaction Details</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={s.empty}>
          {fetchingTx ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : (
            <Text style={{ color: colors.mutedForeground, fontSize: 16, fontFamily: "Inter_400Regular" }}>
              Transaction not found
            </Text>
          )}
        </View>
      </View>
    );
  }

  const isCryptoTransfer = tx.type === "TRANSFER";

  const getBadgeLabel = () => {
    switch (tx.type) {
      case "BUY": return "Fund Wallet";
      case "SELL": return "Bank Transfer";
      case "DEPOSIT":
        /**
         * Three kinds of deposit, and the converted one is also the only chip
         * on this screen that changes as the transaction moves.
         *
         * It says what is happening while it happens, in the pending colour,
         * and settles into what it turned out to be. That line used to sit
         * under the amount as a caption, which put "converting to USDC" and
         * "Converted Deposit" one above the other saying different things
         * about the same deposit.
         */
        // A voucher is not a deposit in the way anybody means the word.
        if (meta.source === "voucher") return "Voucher";
        // A business's payments, settled into this account from Money Moves Business.
        if (meta.source === "business_settlement") return `Settlement from ${meta.businessName ?? "a business"}`;
        if (meta.source === "routed_deposit") {
          if (tx.status === "COMPLETED") return "Converted Deposit";
          if (tx.status === "FAILED") return "Conversion failed";
          return `Converting to ${assetLabel(tx.asset)}`;
        }
        return meta.source === "external_deposit" ? "External Deposit" : "Deposit";
      case "TRANSFER": return "Crypto Transfer";
      case "WITHDRAW": return meta.payee ? `Paid ${meta.payee}` : "Crypto Withdrawal";
      case "LOCK":
      case "SAVINGS_LOCK": return "Savings Lock";
      case "UNLOCK":
      case "SAVINGS_WITHDRAW": return "Savings Withdrawal";
      // The person, not the word "User". Their username is the whole answer
      // to who this was with, and the chip was spending a line to not give it
      // while the table repeated the question two rows down.
      // A voucher you made left the same way a transfer does, but it did not
      // go to a person - it went into escrow to wait for whoever claims it.
      case "TRANSFER_OUT":
        if (meta.source === "voucher") return "Voucher created";
        return transferUsername ? `Sent to @${transferUsername}` : "Sent to User";
      case "TRANSFER_IN": return transferUsername ? `Received from @${transferUsername}` : "Received from User";
      case "AIRTIME": return meta.billType === "electricity" ? "Electricity Purchase" : meta.billType === "betting" ? "Betting Top-up" : meta.billType === "data" ? "Data Purchase" : "Airtime Purchase";
      case "SWEEP": return meta.kind === "swap" ? "Swap" : "Sweep";
      default: return tx.type;
    }
  };

  const getBadgeMark = (): any => {
    switch (tx.type) {
      case "SELL":
        return require("@/assets/images/bank.png");
      case "WITHDRAW":
        return meta.payee ? require("@/assets/images/store.png") : require("@/assets/images/send.png");
      case "DEPOSIT":
        return meta.source === "business_settlement" ? require("@/assets/images/store.png") : null;
      case "TRANSFER_OUT":
        return require("@/assets/images/send.png");
      default:
        return null;
    }
  };

  const getBadgeIcon = (): any => {
    switch (tx.type) {
      case "BUY": return "trending-up";
      case "SELL": return "trending-down";
      case "DEPOSIT": return "download";
      case "TRANSFER": return "send";
      case "WITHDRAW": return "upload";
      case "LOCK":
      case "SAVINGS_LOCK": return "lock";
      case "UNLOCK":
      case "SAVINGS_WITHDRAW": return "unlock";
      case "TRANSFER_OUT": return "arrow-up-right";
      case "TRANSFER_IN": return "arrow-down-left";
      case "AIRTIME": return meta.billType === "electricity" ? "zap" : meta.billType === "betting" ? "target" : "smartphone";
      case "SWEEP": return "layers";
      default: return "activity";
    }
  };

  /**
   * Refunded is neither green nor red.
   *
   * Everything that was not completed or pending fell through to red, which
   * would have shown a customer who got their money back the same colour as
   * one who lost it. Amber says the sale did not happen, which is what did
   * happen, without saying they are out of pocket.
   */
  const statusHue =
    tx.status === "COMPLETED"
      ? "#22c55e"
      : tx.status === "PENDING" || tx.status === "PROCESSING" || tx.status === "REFUNDED"
        ? "#f59e0b"
        : "#ef4444";
  const statusColor = statusHue;
  const statusBg = `${statusHue}18`;

  // Extract real tx hash and wallet address from metadata
  const meta: any = tx.metadata || {};
  // Written by the payout webhook. Absent on anything that never went to a
  // bank, and on bank transfers that settled before we started keeping it.
  const sessionId: string | null = meta.sessionId || null;
  const txHash = meta.txHash || null;
  const walletAddress = meta.walletAddress || null;
  const amountNaira = meta.amountNaira || meta.ngnNet || meta.nairaAmount || null;
  const rawFee = meta.feeNaira ?? meta.ngnFee ?? (meta.ngnGross != null && meta.ngnNet != null ? Math.round(Number(meta.ngnGross) - Number(meta.ngnNet)) : null);
  const feeNaira = rawFee != null && !isNaN(Number(rawFee)) ? Number(rawFee) : null;
  const feePercent = meta.feePercent || (tx.type === "SELL" ? "0.5" : null);
  const isInternalTransfer = tx.type === "TRANSFER_OUT" || tx.type === "TRANSFER_IN";
  const transferUsername = meta.recipientUsername || meta.senderUsername || null;

  // Truncate long addresses/hashes
  const truncate = (s: string) => s.length > 12 ? s.slice(0, 5) + "..." + s.slice(-5) : s;

  const maskAcct = (n: string) => n.length >= 6 ? n.slice(0, 3) + "**" + n.slice(-3) : n;

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

  /**
   * A deposit that arrived as a different token.
   *
   * Every generic row on this screen describes the USDC side, which is the
   * half the person did not choose and cannot recognise: they sent Bitcoin.
   * So the routed ones get their own set, written as a conversion - what went
   * in, what it cost, what came out, and where to check each leg.
   */
  const isRouted = meta.source === "routed_deposit";
  /**
   * A reward, and the receipt for one should feel like the moment it landed.
   *
   * Every other receipt here is a record of money moving. This one is the
   * only row in the list somebody opens to look at again because they
   * enjoyed it, so it keeps the shape of the screen it arrived on.
   */
  /**
   * The claim, not the creation.
   *
   * Both carry source "voucher" - one is money arriving because somebody
   * claimed, the other is money leaving because somebody made one - and this
   * hero says "Voucher claimed" in large type. On a creation that is the
   * wrong sentence about the wrong direction.
   */
  const isVoucher = meta.source === "voucher" && meta.kind !== "created";
  const routedSent =
    meta.sentAmount && meta.sentSymbol ? `${meta.sentAmount} ${meta.sentSymbol}` : null;
  const routedFrom = ROUTED_CHAIN_NAME[Number(meta.chainId)] || null;
  const routedGot =
    tx.status === "COMPLETED" ? `${fmtAsset(tx.amount, tx.asset)} ${assetLabel(tx.asset)}` : null;

  const txDate = new Date(tx.createdAt);

  const assetText = assetLabel(tx.asset);
  type RowItem = {
    label: string;
    value: string;
    copyKey?: string;
    /** Opens the chain's explorer instead of copying. */
    link?: string;
    statusColor?: string;
    statusBg?: string;
  };
  const rows: RowItem[] = [
    // Both of these describe the USDC side. On a conversion that is the half
    // nobody chose, and the routed block below says it properly.
    ...(tx.chain && !isRouted ? [{ label: "Chain", value: ({ MOVE: "Movement", BASE: "Base", SOL: "Solana", BEP20: "BNB Chain", ARB: "Arbitrum", ARC: "Arc", TON: "TON", STELLAR: "Stellar", MONAD: "Monad" } as Record<string, string>)[tx.chain] || tx.chain }] : []),
    ...(isRouted ? [] : [{ label: tx.type === "SELL" ? "Crypto Sold" : "Amount", value: `${fmtAsset(tx.amount, tx.asset)} ${assetText}` }]),

    // ── The conversion, in the order it happens ──
    ...(isRouted && routedSent ? [{ label: "You sent", value: routedSent }] : []),
    ...(isRouted && routedFrom ? [{ label: "On", value: routedFrom }] : []),
    ...(isRouted && meta.sourceTxHash
      ? [{
          // Named for the chain it is on. "Sent in" said nothing about why it
          // opened an explorer, and there are two transactions on this
          // receipt - the one they made and the one that paid them.
          label: `${routedFrom || "Source"} transaction`,
          value: truncate(String(meta.sourceTxHash)),
          link: routedExplorerUrl(Number(meta.chainId), meta.sourceTxHash) || undefined,
        }]
      : []),
    // Neither the gross nor the fee is shown. They were a pair - the gross
    // existed only so the fee had something to be subtracted from - and
    // keeping one without the other leaves a gap on the page with nothing
    // to account for it. What was sent and what arrived are both here, and
    // the note on the deposit screen says the rate decides the difference.
    // Both figures stay in metadata for support.
    ...(isRouted
      ? [{
          label: "You receive",
          // No estimate. Their figure is measured from what actually arrives,
          // so a number here before it lands is one we would have to correct.
          value: routedGot || (tx.status === "FAILED" ? "Nothing" : "Pending settlement"),
          ...(routedGot ? { statusColor: STAGE_DONE } : {}),
        }]
      : []),
    // BTC and Tron land on Solana now, the rest on Movement: the row's own chain says which.
    ...(isRouted ? [{ label: "Arrives on", value: tx.chain === "SOL" ? "Solana" : "Movement" }] : []),
    /**
     * A swap between chains: what left, from where, and what it cost. The
     * amount and chain above are where it arrived; these are the other end.
     */
    ...(tx.type === "SWEEP" && meta.kind === "swap" && meta.from
      ? [
          { label: "You paid", value: `${fmtAsset(meta.from.amount, meta.from.asset)} ${meta.from.symbol}` },
          {
            label: "From",
            value: ({ SOL: "Solana", BASE: "Base", BEP20: "BNB Chain", MONAD: "Monad", TON: "TON" } as Record<string, string>)[meta.from.chain] || meta.from.chain,
          },
          ...(meta.fee?.amount > 0 ? [{ label: `Fee (${(meta.fee.bps ?? 0) / 100}%)`, value: `${fmtAsset(meta.fee.amount, meta.from.asset)} ${meta.fee.symbol}` }] : []),
          ...(tx.status === "REFUNDED" && meta.refundedAmount
            ? [{ label: "Returned", value: `${fmtAsset(meta.refundedAmount, meta.from.asset)} ${meta.from.symbol}`, statusColor: STAGE_PENDING }]
            : []),
          ...(meta.originTxHash
            ? [{
                label: "Sent in",
                value: truncate(String(meta.originTxHash)),
                link: meta.originExplorerUrl || getExplorerUrl(meta.originTxHash, meta.from.chain) || undefined,
              }]
            : []),
        ]
      : []),
    /**
     * A sweep is several transfers under one row, and which of them worked is
     * the thing somebody opens this screen to find out.
     *
     * One landing and one reverting is an ordinary outcome, not a failure, so
     * the row above stays successful for what arrived and the legs say what
     * became of each chain underneath it. Only a sweep where nothing landed is
     * a failed one, and then every leg reads the same way and says so.
     */
    ...(tx.type === "SWEEP" && Array.isArray(meta.legs)
      ? (meta.legs as any[]).map((l) => {
          const where =
            ({ SOL: "Solana", BASE: "Base", BEP20: "BNB Chain" } as Record<string, string>)[
              l.chain
            ] || l.chain;
          const landed = l.status === "landed";
          const hash = l.txHash ? getExplorerUrl(l.txHash, l.chain) : null;
          return {
            label: `${assetLabel(l.asset)} on ${where}`,
            value: landed
              ? `${fmtAsset(l.amount, l.asset)} arrived`
              : l.status === "failed"
                ? "Did not go"
                : l.status === "sent"
                  ? "Held — being looked at"
                  : "Never sent",
            statusColor: landed ? STAGE_DONE : l.status === "failed" ? STAGE_FAILED : STAGE_PENDING,
            ...(hash ? { link: hash } : {}),
          };
        })
      : []),
    // Not here as well: the chip under the amount names them now, and this
    // row said the same thing in the same words a few lines lower.
    ...(transferUsername && !isInternalTransfer ? [{ label: tx.type === "TRANSFER_OUT" ? "Sent to" : "Received from", value: `@${transferUsername}` }] : []),
    ...(isInternalTransfer ? [{ label: "Type", value: "Internal Transfer" }] : []),
    // A business's checkout paid from here: who, what for, and the reference the business has for it.
    ...(meta.payee
      ? [
          { label: "Type", value: "Business payment" },
          { label: "Paid to", value: meta.payee },
          ...(meta.payFor ? [{ label: "For", value: meta.payFor }] : []),
          ...(meta.priceLabel ? [{ label: "Priced at", value: meta.priceLabel }] : []),
          ...(meta.payeeRef ? [{ label: "Checkout reference", value: meta.payeeRef, copyKey: "payeeRef" }] : []),
        ]
      : []),
    ...(meta.source === "external_deposit" ? [{ label: "Source", value: "External Wallet (On-chain)" }] : []),
    ...(meta.source === "business_settlement"
      ? [
          { label: "Type", value: "Business settlement" },
          { label: "From", value: meta.businessName ?? "Money Moves Business" },
          ...(meta.settlementRef ? [{ label: "Settlement reference", value: meta.settlementRef }] : []),
        ]
      : []),
    // Only a public code is ever named. A QR-only one is withheld everywhere
    // it could be read back, this receipt included.
    ...(meta.source === "voucher"
      ? [{ label: "Voucher", value: meta.voucherCode || "Scanned" }]
      : []),
    // What the pot was cut into, on the creator's copy. The claimer's receipt
    // has no business knowing how many other people were invited.
    ...(meta.kind === "created" && meta.winners
      ? [{ label: "Split between", value: `${meta.winners} ${meta.winners === 1 ? "person" : "people"}` }]
      : []),
    ...(meta.kind === "created" && meta.mode
      ? [{ label: "How it splits", value: meta.mode === "LUCKY" ? "Lucky dip" : "Same each" }]
      : []),
    ...(meta.kind === "created" && meta.endsAt
      ? [{
          label: "Expires",
          value: new Date(meta.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
        }]
      : []),
    ...(meta.phone ? [{ label: meta.billType === "electricity" ? "Meter Number" : meta.billType === "betting" ? "Account ID" : "Phone Number", value: meta.phone }] : []),
    ...((meta.billType === "electricity" || meta.billType === "betting") && meta.customerName ? [{ label: meta.billType === "betting" ? "Account Name" : "Customer Name", value: meta.customerName }] : []),
    ...(meta.network ? [{ label: meta.billType === "electricity" ? "Biller" : meta.billType === "betting" ? "Bookmaker" : "Network", value: meta.disco || meta.network }] : []),
    ...(meta.billType === "electricity" && meta.meterType ? [{ label: "Meter Type", value: meta.meterType === "prepaid" ? "Prepaid" : "Postpaid" }] : []),
    ...(meta.planLabel ? [{ label: "Plan", value: meta.planLabel }] : []),
    ...((meta.billType === "electricity" && (meta.electricityUnits || meta.vtuResult?.data?.units || meta.vtuResult?.units)) ? [{ label: "Units", value: meta.electricityUnits || meta.vtuResult?.data?.units || meta.vtuResult?.units }] : []),
    ...(meta.bankName ? [{ label: "Bank", value: meta.bankName }] : []),
    ...(meta.accountNumber ? [{ label: "Account", value: `${meta.accountName || ""} • ${maskAcct(meta.accountNumber)}` }] : []),
    // An internal transfer's note is a bubble under the amount, not a row: it
    // is somebody talking, and a table is where that stops sounding like it.
    // A bank narration stays a row - it is a field on a payout instruction.
    ...(meta.narration && !isInternalTransfer ? [{ label: "Narration", value: meta.narration }] : []),
    ...(amountNaira && tx.type !== "SELL" ? [{ label: "NGN Value", value: fmtNaira(amountNaira) }] : []),
    // A sell fee is a percentage plus a flat charge, so one "Fee — ₦53 (0.5%)"
    // row was quietly wrong: ₦53 is not 0.5% of anything, it is 0.5% AND ₦50.
    ...(!isInternalTransfer && feeNaira != null && tx.type === "SELL"
      ? [
          { label: `Platform fee (${(SELL_FEE_RATE * 100).toFixed(1)}%)`, value: fmtNaira(splitSellFee(Number(feeNaira)).platform) },
          { label: "Processing fee", value: fmtNaira(splitSellFee(Number(feeNaira)).processing) },
        ]
      : !isInternalTransfer && feeNaira != null
        ? [{ label: "Fee", value: `${fmtNaira(feeNaira)}${feePercent ? ` (${feePercent}%)` : ""}` }]
        : !isInternalTransfer && tx.fee != null && Number(tx.fee) > 0
          ? [{ label: "Fee", value: `${fmtAsset(tx.fee, tx.asset)} ${assetText}` }]
          : []),
    /**
     * The proof the bank will accept.
     *
     * Flutterwave labels this "Proof" on its own dashboard; to a Nigerian bank
     * it is the NIP session id, and it is the one thing that settles an
     * argument about whether a transfer actually left. Support was reading it
     * off the dashboard and pasting it into chat by hand - it belongs to the
     * person it was sent for, so it is on their receipt.
     *
     * Truncated with the copy beside it, because nobody reads thirty digits
     * and everybody needs all thirty when they hand it over.
     */
    ...(sessionId
      ? [{ label: "Session ID", value: truncate(sessionId), copyKey: "session" }]
      : []),
    // Truncated like every other long value here. A routed reference carries
    // the provider's own deposit id, which is forty characters and wrapped
    // onto three lines.
    ...(tx.reference
      ? [{ label: "Reference", value: truncate(tx.reference), copyKey: "ref" }]
      : []),
    ...(walletAddress ? [{ label: "Wallet", value: truncate(walletAddress), copyKey: "wallet" }] : []),
    ...(txHash
      ? [
          // On a conversion this is the leg that paid them, not the one they
          // sent - the source transaction is named above.
          explorerUrl
            ? { label: isRouted ? "Paid out in" : "Transaction Hash", value: truncate(txHash), link: explorerUrl }
            : { label: isRouted ? "Paid out in" : "Transaction Hash", value: truncate(txHash), copyKey: "hash" },
        ]
      : []),
  ];

  // Full values for copying (before truncation)
  const copyValues: Record<string, string> = {};
  if (walletAddress) copyValues["wallet"] = walletAddress;
  if (txHash) copyValues["hash"] = txHash;
  if (tx.reference) copyValues["ref"] = tx.reference;
  if (sessionId) copyValues["session"] = sessionId;
  if (meta.payeeRef) copyValues["payeeRef"] = meta.payeeRef;
  const elecToken = meta.electricityToken || meta.vtuResult?.recharge_token || meta.vtuResult?.data?.token || meta.vtuResult?.token || meta.vtuResult?.data?.purchased_code || meta.vtuResult?.purchased_code;
  if (elecToken) copyValues["elecToken"] = elecToken;

  /**
   * What happened, in the order it happened.
   *
   * Only stages the transaction actually reached are listed. We hold two
   * timestamps - when it was created and when it last changed - so Initiated
   * and Processing share the first and the outcome takes the second. Inventing
   * a moment for a stage we never recorded would be worse than the repetition.
   */
  const failed = tx.status === "FAILED";
  const done = tx.status === "COMPLETED";

  /**
   * Solid marks rather than outlines: at this size a stroked glyph reads as
   * grey whatever colour it is given, which defeats the one job they have.
   *
   * `kind` picks how each is drawn - a knocked-out disc for the send-off, a
   * dot for the middle, the badge artwork for the end.
   */
  const stageIdle = colors.foreground + "B3";
  /**
   * A sell that was never signed never processed.
   *
   * It was prepared, the phone could not sign it, and nothing reached a chain
   * or a bank. Showing "Processing" between Initiated and Failed describes a
   * stage it never entered, and next to a list of fees it reads as money that
   * was taken and lost.
   */
  const neverSigned = tx.type === "SELL" && failed && !txHash && !meta.payoutStatus;

  const timeline = [
    { label: "Initiated", color: stageIdle, kind: "sent" as const },
    ...(neverSigned
      ? []
      : [{ label: "Processing", color: STAGE_PENDING, kind: "dot" as const }]),
    ...(done
      ? [{ label: tx.type === "AIRTIME" ? "Delivered" : "Completed", color: STAGE_DONE, kind: "badge" as const }]
      : []),
    ...(failed ? [{ label: "Failed", color: STAGE_FAILED, kind: "failed" as const }] : []),
  ];

  const statusText = done
    ? tx.type === "AIRTIME"
      ? "Delivered"
      : "Successful"
    : failed
      ? "Failed"
      : "Processing";
  const pillColor = done ? STAGE_DONE : failed ? STAGE_FAILED : STAGE_PENDING;

  const providerLogo = meta.network ? PROVIDER_LOGOS[String(meta.network).toUpperCase()] : undefined;

  const nairaHero = (tx.type === "SELL" || tx.type === "AIRTIME") && amountNaira;

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      {/* A sheet, so it gets a handle rather than a header. The route is
          presented from the bottom; this is the thing you pull down on. */}
      <View style={[s.grip, { backgroundColor: colors.border }]} />

      {/* Android has no edge-swipe back the way iOS does, and a grip alone
          reads as decoration there, so the way out is spelled out. iOS keeps
          the grip on its own - a button would duplicate a gesture people
          already have. */}
      {Platform.OS === "android" && (
        <TouchableOpacity
          style={[s.androidBack, { backgroundColor: colors.muted }]}
          onPress={handleBack}
          hitSlop={10}
          activeOpacity={0.75}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </TouchableOpacity>
      )}

      {/* Fires once each time the receipt is opened. It is a reward, and the
          only screen in this list anybody reopens for the pleasure of it. */}
      {isVoucher && <Confetti />}

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: bottomPad + 150 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.statusPill, { backgroundColor: pillColor + "26" }]}>
          <Text style={[s.statusText, { color: pillColor }]}>{statusText}</Text>
          {done ? (
            <Image
              source={require("@/assets/images/checklist-green.png")}
              style={s.statusBadge}
              resizeMode="contain"
            />
          ) : (
            <Ionicons name={failed ? "close-circle" : "time"} size={15} color={pillColor} />
          )}
        </View>

        {isVoucher ? (
          <View style={s.voucherHero}>
            <Text style={[s.voucherWord, { color: colors.foreground }]}>Voucher claimed</Text>
            <View style={s.voucherFigure}>
              <Text style={[s.voucherAmount, { color: colors.primary }]}>
                +{fmtAsset(tx.amount, tx.asset)}
              </Text>
              <Text style={[s.voucherUnit, { color: colors.foreground }]}>{assetText}</Text>
            </View>
            <Text style={[s.voucherNote, { color: colors.mutedForeground }]}>
              in your Money Moves wallet
            </Text>
          </View>
        ) : nairaHero ? (
          <View style={s.amountRow}>
            <Image
              source={require("@/assets/images/nairaiconnew.png")}
              style={[s.naira, { tintColor: colors.foreground }]}
            />
            <Text style={[s.amount, { color: colors.foreground }]}>
              {Number(amountNaira).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
            </Text>
          </View>
        ) : isRouted ? (
          /* The figure that means something, and where it came from.
             Until it settles that is what they sent - their USDC number is
             measured from what actually arrives, so there is nothing
             truthful to put in the headline yet and "0 USDC" read as money
             that arrived and came to nothing. */
          <View style={s.convHero}>
            <Text style={[s.amount, s.amountAlone, { color: colors.foreground }]}>
              {done ? `${fmtAsset(tx.amount, tx.asset)} ${assetText}` : routedSent || "—"}
            </Text>
            {done && (
              <Text style={[s.convFrom, { color: colors.mutedForeground }]}>
                converted from {routedSent || "your deposit"}
              </Text>
            )}
          </View>
        ) : (
          <Text style={[s.amount, s.amountAlone, { color: colors.foreground }]}>
            {fmtAsset(tx.amount, tx.asset)} {assetText}
          </Text>
        )}

        {/* A conversion in progress carries the pending colour here, because
            here is where it says so. Everything else keeps the neutral chip -
            the status pill above already states the status, and colouring
            every chip would leave nothing for the one that is changing. */}
        <View
          style={[
            s.kindPill,
            { backgroundColor: isRouted && !done ? pillColor + "1F" : colors.card },
          ]}
        >
          {providerLogo ? (
            <Image source={providerLogo} style={s.kindLogo} resizeMode="contain" />
          ) : isRouted && !done ? (
            <Ionicons name={failed ? "close-circle" : "time"} size={13} color={pillColor} />
          ) : getBadgeMark() ? (
            <Image
              source={getBadgeMark()}
              style={[s.kindMark, { tintColor: colors.mutedForeground }]}
            />
          ) : (
            <Feather name={getBadgeIcon()} size={13} color={colors.mutedForeground} />
          )}
          <Text
            style={[
              s.kindText,
              { color: isRouted && !done ? pillColor : colors.foreground },
            ]}
          >
            {getBadgeLabel()}
          </Text>
        </View>

        {/* What they said it was for, said the way they said it.
            Buried in the table between Type and NGN Value, a line somebody
            wrote by hand read as another machine field - and it is the line
            most people open this screen for.

            No container: a pill, a chip and a card are already stacked here,
            and a fourth rounded box would have nothing left to distinguish
            it. One quote mark and the words at 17pt is the whole treatment. */}
        {isInternalTransfer && !!meta.narration && (
          <View style={s.noteWrap}>
            <Text style={[s.noteMark, { color: colors.primary }]}>{"“"}</Text>
            <Text style={[s.noteText, { color: colors.foreground }]}>{meta.narration}</Text>
          </View>
        )}

        {/* The question this screen exists to answer for a failed sell.
            The fees are listed below as part of the quote it would have been,
            and without this line they read as money that was taken. */}
        {neverSigned && (
          <View style={[s.nothingTaken, { backgroundColor: colors.muted }]}>
            <Feather name="shield" size={14} color={colors.mutedForeground} />
            <Text style={[s.nothingTakenText, { color: colors.mutedForeground }]}>
              Nothing was charged. Your crypto never left your wallet.
            </Text>
          </View>
        )}

        {/* The one thing on this receipt somebody has to act on.
            A prepaid token is twenty digits typed into a meter by hand, off a
            phone held in the other one - so it gets grouped in fours, set at a
            size you can read at arm's length, and made tappable across its
            whole width. As a row in the table below it sat between Meter Type
            and Units at 13pt, which is the wrong rank for the only part of the
            receipt that does anything. */}
        {!!elecToken && (
          <TouchableOpacity
            style={[s.tokenCard, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "2E" }]}
            activeOpacity={0.7}
            onPress={() => copyToClipboard(String(elecToken), "elecToken")}
          >
            <View style={s.tokenHead}>
              <Text style={[s.tokenLabel, { color: colors.mutedForeground }]}>
                Electricity token
              </Text>
              <View style={s.tokenCopy}>
                <Feather
                  name={copiedField === "elecToken" ? "check" : "copy"}
                  size={13}
                  color={copiedField === "elecToken" ? "#22c55e" : colors.mutedForeground}
                />
                <Text
                  style={[
                    s.tokenCopyText,
                    { color: copiedField === "elecToken" ? "#22c55e" : colors.mutedForeground },
                  ]}
                >
                  {copiedField === "elecToken" ? "Copied" : "Copy"}
                </Text>
              </View>
            </View>
            <Text
              style={[s.tokenValue, { color: colors.foreground }]}
              selectable
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {groupToken(String(elecToken))}
            </Text>
          </TouchableOpacity>
        )}

        <View style={[s.card, { backgroundColor: colors.card }]}>
          <StageTrack stages={timeline} />
        </View>

        <View style={[s.card, { backgroundColor: colors.card }]}>
          {rows.map((row, i) => (
            <View key={`${row.label}-${i}`} style={s.row}>
              <Text style={[s.rowLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
              {row.link ? (
                <TouchableOpacity
                  style={s.rowCopy}
                  onPress={() => Linking.openURL(row.link!).catch(() => {})}
                  hitSlop={8}
                >
                  <Text style={[s.rowValue, { color: colors.mutedForeground }]}>{row.value}</Text>
                  <Feather name="external-link" size={13} color={colors.mutedForeground} />
                </TouchableOpacity>
              ) : row.copyKey ? (
                <TouchableOpacity
                  style={s.rowCopy}
                  onPress={() => copyToClipboard(copyValues[row.copyKey!] || row.value, row.copyKey!)}
                  hitSlop={8}
                >
                  <Text style={[s.rowValue, { color: colors.foreground }]}>{row.value}</Text>
                  <Feather
                    name={copiedField === row.copyKey ? "check" : "copy"}
                    size={13}
                    color={copiedField === row.copyKey ? "#22c55e" : colors.mutedForeground}
                  />
                </TouchableOpacity>
              ) : (
                <Text style={[s.rowValue, { color: colors.foreground }]}>{row.value}</Text>
              )}
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[s.dock, { backgroundColor: colors.background, paddingBottom: bottomPad + 10 }]}>
        {done ? (
          <>
            <TouchableOpacity
              style={[s.receiptBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push({ pathname: "/transactions/receipt", params: { id: tx.id } } as any)}
              activeOpacity={0.85}
            >
              <Text style={[s.receiptBtnText, { color: colors.primaryForeground }]}>View receipt</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.reportBtn}
              onPress={() => router.push("/account/support" as any)}
              activeOpacity={0.7}
            >
              <Text style={[s.reportText, { color: colors.foreground }]}>Report an issue</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[s.receiptBtn, { backgroundColor: colors.muted }]}
            onPress={() => router.push("/account/support" as any)}
            activeOpacity={0.85}
          >
            <Text style={[s.receiptBtnText, { color: colors.foreground }]}>Report an issue</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  grip: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10, marginBottom: 18 },
  androidBack: {
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    marginLeft: 20,
    marginTop: 8,
    marginBottom: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
  },

  content: { paddingHorizontal: 20, alignItems: "center" },

  statusPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999 },
  statusText: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.1 },
  statusBadge: { width: 16, height: 16 },

  amountRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 18 },
  // Box, not glyph: `contain` scales the mark's transparent margin too, so
  // it fills about two thirds of what is set here. 41 lands it on the cap
  // height of the 38pt figure; the lift puts it on their baseline.
  naira: { width: 41 * FONT_SCALE, height: 41 * FONT_SCALE, resizeMode: "contain", marginRight: -4 * FONT_SCALE, marginBottom: 4 * FONT_SCALE },
  amount: { fontSize: 38, lineHeight: 46, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.4 },
  amountAlone: { marginTop: 18, textAlign: "center" },

  // The claim screen's shape, kept: the words, then the figure.
  voucherHero: { alignItems: "center", marginTop: 16 },
  voucherWord: { fontSize: 26, lineHeight: 32, fontFamily: "Inter_800ExtraBold", letterSpacing: -1 },
  voucherFigure: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 12 },
  voucherAmount: {
    fontSize: 44,
    lineHeight: 50,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -2,
    fontVariant: ["tabular-nums"],
  },
  voucherUnit: { fontSize: 17, fontFamily: "Inter_500Medium" },
  voucherNote: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 8 },
  convHero: { alignItems: "center" },
  // Lower case and close under the figure, so the pair reads as one sentence
  // rather than as a heading with a caption.
  convFrom: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
    marginTop: 6,
    textAlign: "center",
  },

  kindPill: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, marginTop: 14 },
  kindLogo: { width: 17, height: 17, borderRadius: 8.5 },
  kindMark: { width: 14, height: 14, resizeMode: "contain" },
  kindText: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_700Bold" },

  nothingTaken: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginTop: 18,
    alignSelf: "stretch",
  },
  nothingTakenText: { flex: 1, fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_500Medium" },
  tokenCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 13,
    paddingBottom: 17,
    // It had a bottom margin and no top one, so it sat against the chip above
    // it - the two read as one stuck-together block rather than a label and
    // the thing it labels.
    marginTop: 22,
    marginBottom: 14,
    // Same width as the cards below it, rather than however wide the digits
    // happen to make it.
    alignSelf: "stretch",
  },
  tokenHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tokenLabel: { fontSize: 11.5, fontFamily: "Inter_500Medium", letterSpacing: 0.3, textTransform: "uppercase" },
  tokenCopy: { flexDirection: "row", alignItems: "center", gap: 5 },
  tokenCopyText: { fontSize: 11.5, fontFamily: "Inter_600SemiBold" },
  // Big enough to read at arm's length, tabular so the groups line up.
  tokenValue: {
    fontSize: 19,
    lineHeight: 26,
    marginTop: 8,
    fontFamily: "Inter_700Bold",
    // Groups of four already do the separating; extra tracking on top of that
    // is what pushed twenty digits into the edges of the card.
    letterSpacing: 0,
    fontVariant: ["tabular-nums"],
  },
  noteWrap: { alignSelf: "center", alignItems: "center", maxWidth: "86%", marginTop: 20 },
  /**
   * The mark is pulled up under itself, not spaced away from the words.
   *
   * A quotation mark occupies only the top fifth of its em box, so a 32-point
   * glyph leaves about 26 points of empty line beneath it and the note drifts
   * a paragraph away from the thing quoting it. The negative margin takes
   * that back and leaves the gap the mark actually looks like it has.
   */
  noteMark: { fontSize: 32, lineHeight: 32, fontFamily: "Inter_800ExtraBold", marginBottom: -14 },
  noteText: {
    fontSize: 17, lineHeight: 23, fontFamily: "Inter_500Medium",
    textAlign: "center", letterSpacing: -0.25,
  },

  card: { alignSelf: "stretch", borderRadius: 18, padding: 16, marginTop: 16 },



  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, paddingVertical: 9 },
  rowLabel: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", flexShrink: 0 },
  rowValue: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold", textAlign: "right", flexShrink: 1 },
  rowCopy: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 },

  dock: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12 },
  receiptBtn: { height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  receiptBtnText: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
  reportBtn: { alignItems: "center", paddingVertical: 14 },
  reportText: { fontSize: 14.5, lineHeight: 19, fontFamily: "Inter_700Bold" },

  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },

  /* Hero */
  heroCard: {
    borderRadius: 20, padding: 28, alignItems: "center", gap: 8,
  },
  heroIconCircle: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  badge: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 8,
  },
  badgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  heroAmount: { fontSize: 34, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  heroDate: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },

  /* Detail Card */
  detailCard: { borderRadius: 16, overflow: "hidden" },
  detailRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 15,
  },
  detailLabel: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  detailRight: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, maxWidth: "60%" },
  detailValue: { fontSize: 13, fontFamily: "Inter_500Medium" },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },


  copyBtn: { padding: 4 },

  /* Buttons */
  btnRow: { marginTop: 4 },
  primaryBtn: {
    height: 52, borderRadius: 14, flexDirection: "row",
    alignItems: "center", justifyContent: "center",
  },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  outlineBtn: {
    height: 52, borderRadius: 14, borderWidth: 1, flexDirection: "row",
    alignItems: "center", justifyContent: "center",
  },
  outlineBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  /* Fee info modal */
  feeOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 32,
  },
  feeCard: {
    borderRadius: 20, padding: 28, alignItems: "center", width: "100%",
  },
  feeIconWrap: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  feeTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 10 },
  feeDesc: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, marginBottom: 24 },
  feeBtn: { width: "100%", height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  feeBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
