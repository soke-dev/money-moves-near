import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";
import { TokenLogo } from "@/components/TokenLogo";
import { assetLabel, bankLogoSource, fmtNaira } from "@/constants/transfer";
import { ROUTED_CHAIN_LOGO } from "@/services/routed-deposits";

/**
 * The accent for money coming in, one per theme.
 *
 * On black the raw brand lime is held back slightly: at 15pt bold on the
 * background the identical value reads brighter than it does on a disc, so the
 * text carries a little less alpha to land in the same place.
 *
 * On white that lime is barely legible - it is a colour built to glow on black
 * - so the light theme takes the darker brand green instead. Same signal,
 * readable on the page it is actually printed on.
 */
const AMOUNT_IN_DARK = "#81FB02DB";
const AMOUNT_IN_LIGHT = "#4a7c00";

/** "COLLINS OKOTETE" as a person rather than a shout. Hyphens and O'Brien survive. */
function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/(^|[\s'\-])([a-z])/g, (_m, lead, ch) => lead + ch.toUpperCase());
}

const CHAIN_NAMES: Record<string, string> = {
  MOVE: "Movement",
  SOL: "Solana",
  BASE: "Base",
  BEP20: "BNB Chain",
  ARC: "Arc",
  TON: "TON",
  STELLAR: "Stellar",
  MONAD: "Monad",
  ARB: "Arbitrum",
};

const CHAIN_LOGOS: Record<string, any> = {
  MOVE: require("@/assets/images/movementnew.jpg"),
  SOL: require("@/assets/images/solana.png"),
  BASE: require("@/assets/images/base logo.png"),
  BEP20: require("@/assets/images/bsc logo.png"),
  ARC: require("@/assets/images/ARC.jpg"),
  TON: require("@/assets/images/toncoin.png"),
  STELLAR: require("@/assets/images/stellar.jpg"),
  MONAD: require("@/assets/images/monad.png"),
  ARB: require("@/assets/images/arbitrumlogo.png"),
};

interface TransactionItemProps {
  type: string;
  asset: string;
  chain?: string | null;
  amount: number;
  status: string;
  createdAt: string;
  metadata?: any;
  onPress?: () => void;
}

export function TransactionItem({
  type,
  asset,
  chain,
  amount,
  status,
  createdAt,
  metadata,
  onPress,
}: TransactionItemProps) {
  const colors = useColors();
  const { isDark } = useTheme();
  const label = assetLabel(asset);

  const getLabel = () => {
    switch (type) {
      case "BUY": return `Bought ${label}`;
      case "SELL": return `Sold ${label}`;
      case "DEPOSIT":
        if (metadata?.source === "business_settlement") return `Settlement from ${metadata.businessName ?? "a business"}`;
        return metadata?.source === "external_deposit" ? `Received ${label}` : `Deposited ${label}`;
      case "TRANSFER": return "Sold / Transferred";
      // These fell through to `default` and printed the raw enum - "TRANSFER_OUT"
      // - straight into the list.
      case "TRANSFER_OUT":
        if (metadata?.source === "voucher") return "Voucher created";
        return metadata?.recipientUsername ? `Sent to @${metadata.recipientUsername}` : `Sent ${label}`;
      case "TRANSFER_IN":
        return metadata?.senderUsername ? `From @${metadata.senderUsername}` : `Received ${label}`;
      case "AIRTIME": return metadata?.billType === "electricity" ? "Electricity Purchase" : metadata?.billType === "betting" ? "Betting Top-up" : metadata?.billType === "data" ? "Data Purchase" : "Airtime Purchase";
      case "DATA": return "Data Purchase";
      case "LOCK":
      case "SAVINGS_LOCK": return `Locked ${label}`;
      case "UNLOCK":
      case "SAVINGS_WITHDRAW": return `Unlocked ${label}`;
      // A business's checkout, paid from the wallet: who was paid, not "withdrew".
      case "WITHDRAW": return metadata?.payee ? `Paid ${metadata.payee}` : `Withdrew ${label}`;
      /**
       * A swap, and it always was.
       *
       * This fell through to default, which returns the raw enum - so the
       * list read "SWEEP" in capitals while the detail screen it opens has
       * said "Swap" all along. The word the feature goes by is swap.
       */
      // A swap between chains names both ends; a sweep gathers small balances one way.
      case "SWEEP":
        return metadata?.kind === "swap" && metadata?.from?.symbol
          ? `Swapped ${metadata.from.symbol} to ${metadata.to?.symbol ?? label}`
          : `Swept to ${label}`;
      default: return type;
    }
  };

  // Money in is drawn in the brand colour rather than a status green - green
  // already means COMPLETED on the badge beside it.
  const isPositive =
    type === "BUY" || type === "DEPOSIT" || type === "SAVINGS_WITHDRAW" ||
    /**
     * A swap counts as money in.
     *
     * The row records where the money ARRIVED - USDCx on Movement - because
     * that is the one figure a swap produces from however many legs it took.
     * Signing it negative said four USDC had left, when the whole point is
     * that four USDC turned up in one place. What left is the scattered
     * balances, and each of those is a leg in the detail, not this line.
     */
    type === "SWEEP" ||
    type === "UNLOCK" || type === "TRANSFER_IN";

  const getStatusColor = () => {
    switch (status) {
      case "COMPLETED": return colors.success;
      case "PENDING":
      case "PROCESSING": return colors.warning;
      case "FAILED": return colors.destructive;
      // Money that came back is neither a delivery nor a loss. Its own colour,
      // the same amber-adjacent one the detail screen and the admin use.
      case "REFUNDED": return colors.warning;
      default: return colors.mutedForeground;
    }
  };

  /**
   * A payout to a bank, which is a different kind of row.
   *
   * Everything else here is a crypto movement and is described in crypto: an
   * asset logo, a chain badge, an amount to eight decimals. None of that means
   * anything for money that has left for a bank account - what matters is who
   * received it and how much naira. Recognised by the recipient and the naira
   * figure both being present, so a sell that has not been paid out yet still
   * renders as the crypto movement it currently is.
   */
  const payeeName: string | undefined = metadata?.accountName;
  const nairaAmount: number | undefined =
    metadata?.ngnNet ?? metadata?.ngnGross ?? metadata?.amountNaira;
  const isBankPayout = !!payeeName && typeof nairaAmount === "number";

  /**
   * Crypto bought with naira. Described the other way round from a crypto
   * movement: the token amount is the headline and the naira is the figure on
   * the right, because what you chose was an amount of naira to spend.
   */
  const isNairaBuy = type === "BUY" && typeof metadata?.amountNaira === "number";
  /**
   * Crypto moving, in either direction: arriving from outside, withdrawn to an
   * address, or sent to another user.
   *
   * No naira figure exists for any of these, so the crypto amount stays on the
   * right and the chain moves into the subtitle - it was only ever readable as
   * a small badge on the logo, and which chain it moved on is the thing you
   * actually want to know.
   */
  const isCryptoMove =
    type === "DEPOSIT" ||
    type === "WITHDRAW" ||
    type === "TRANSFER_OUT" ||
    type === "TRANSFER_IN";
  // Dollar coins read like money, to the cent - "0.37 USDC" in and out alike. Other tokens keep
  // their precision, trailing zeros trimmed - "0.0021 SOL", not "0.0021000 SOL".
  const stable = /^(USDC|USDCX|USDT|CNGN)$/i.test(String(asset));
  const tokenAmount = stable ? amount.toFixed(2) : String(Number(amount.toFixed(asset === "ETH" ? 6 : 4)));

  /**
   * A deposit that arrived as something else.
   *
   * Bitcoin, Tron USDT and the rest are converted on the way in and land as
   * USDC, so the row is a USDC deposit and the column says USDC. But until it
   * settles there is no USDC figure - their number comes from what actually
   * arrives after fees - and a row reading "+0 USDC" describes money that
   * arrived and came to nothing.
   *
   * So while it is converting the row shows what was SENT, in the token it was
   * sent in, with no plus sign: nothing has been added yet. When it lands the
   * row becomes an ordinary USDC deposit like any other.
   */
  const isRouted = metadata?.source === "routed_deposit";
  /**
   * A reward, not money appearing.
   *
   * It arrives as USDC on Movement like any deposit, so without this it reads
   * as one - and "USDC Deposit" is the one description that cannot say where
   * it came from.
   */
  const isVoucher = metadata?.source === "voucher";
  /**
   * The claim, not the creation. They run in opposite directions.
   *
   * Both carry source "voucher": one is money arriving because somebody
   * claimed, the other is money leaving because somebody made one. The mark
   * below is right for both - it is a voucher either way - but the wording is
   * not, and the row said "Voucher claimed · Reward" over a debit.
   *
   * It also short-circuits getLabel(), which is why the "Voucher created"
   * title already written in there never had a chance to run.
   */
  const isVoucherClaim = isVoucher && metadata?.kind !== "created";
  const sentSymbol: string | undefined = metadata?.sentSymbol || undefined;
  const sentAmount: string | undefined = metadata?.sentAmount || undefined;
  const routedPending = isRouted && status !== "COMPLETED" && status !== "FAILED";
  /**
   * Which network it was sent on, beside the token it was sent in.
   *
   * "USDT Deposit" is two different deposits depending on the chain, and
   * the chain is the part that decides whether the money arrives. The row's
   * own logo is the token, so the network goes next to the title.
   */
  const routedChainLogo = isRouted ? ROUTED_CHAIN_LOGO[Number(metadata?.chainId)] : undefined;
  /**
   * The mark after the title, on converted deposits only.
   *
   * Every other row already names its chain in the subtitle, and a mark on
   * all of them made a column of badges that distinguished nothing. This is
   * the one row where the chain is not the one in the `chain` column: it was
   * sent on Ethereum or Bitcoin and lands on Movement, and the chain it was
   * sent on is the one the person chose.
   *
   * A node rather than a component: declaring one in here would be a new type
   * on every render, and React would tear the image down and rebuild it each
   * time the list refreshed.
   */
  const titleMark = routedChainLogo ? (
    <TokenLogo symbol={routedChainLogo} size={13} />
  ) : null;

  /**
   * Bills, which are named by provider rather than by asset - the network for
   * airtime and data, the disco for electricity.
   */
  const billType: string | undefined = metadata?.billType;
  const billNaira: number | undefined = metadata?.totalNaira ?? metadata?.nairaAmount;
  const isTopUp =
    (billType === "airtime" || billType === "data" || billType === "electricity" || billType === "betting") &&
    typeof billNaira === "number";
  const billWord =
    billType === "data" ? "Data"
      : billType === "electricity" ? "Electricity"
      : billType === "betting" ? "Betting"
      : "Airtime";
  // Remote for most, bundled for a few, and absent for the rest - so the glyph
  // stays as the fallback rather than being replaced.
  const bankLogo = bankLogoSource(metadata?.bankName);

  // No leading zero on the day - "Sep 9", not "Sep 09".
  const shortDate = new Date(createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeStr = new Date(createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  /**
   * The time, then the day.
   *
   * A row used to carry one or the other - the time if it happened today, the
   * date otherwise. Which meant two transfers to the same account on the same
   * day were the same line twice, and the only way to tell them apart was to
   * open one. The time leads because within a day it is the part that differs.
   */
  const whenStr = `${timeStr.toLowerCase()} · ${shortDate}`;
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

  // Bare marks in the text colour, the same as the token rows carry: white in
  // the dark, black in the light, on nothing.
  const discMark = isDark ? "#FFFFFF" : "#000000";
  const AMOUNT_IN = isDark ? AMOUNT_IN_DARK : AMOUNT_IN_LIGHT;

  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress ? { onPress, activeOpacity: 0.7 } : {};

  if (isTopUp) {
    return (
      <Wrapper {...wrapperProps} style={styles.container}>
        {/* Drawn the same way as the token rows - no disc - so a list of bills
            and transfers reads as one column rather than two treatments. */}
        <View style={styles.markSlot}>
          <Image
            source={
              billType === "electricity"
                ? require("@/assets/images/flash.png")
                : billType === "data"
                  ? require("@/assets/images/wifi.png")
                  : billType === "betting"
                    ? require("@/assets/images/football.png")
                    : require("@/assets/images/telephone-call.png")
            }
            style={[
              styles.billGlyph,
              // Taller than it is wide, so it needs the extra height to match
              // the visual weight of the wifi and phone marks.
              billType === "electricity" && styles.boltGlyph,
              { tintColor: discMark },
            ]}
          />
        </View>

        <View style={styles.info}>
          <Text style={[styles.payee, { color: colors.foreground }]} numberOfLines={1}>
            {metadata?.network || billWord}
          </Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {billWord} · {whenStr}
          </Text>
        </View>

        <View style={styles.right}>
          <Text
            style={[
              styles.payeeAmount,
              { color: colors.foreground },
              status === "FAILED" && styles.struck,
            ]}
          >
            {`- ${fmtNaira(billNaira!)}`}
          </Text>
          {status !== "COMPLETED" && (
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor() + "22" }]}>
              <Text style={[styles.statusText, { color: getStatusColor() }]}>{statusLabel}</Text>
            </View>
          )}
        </View>
      </Wrapper>
    );
  }

  if (isCryptoMove) {
    /**
     * The mark says what happened, not which coin - the asset is already named
     * in the amount, and a token logo would make every one of these look like
     * any other USDC row.
     *
     * A send to a username is about the person; a withdrawal is about the money
     * leaving. Deposits and incoming transfers keep the token, since what
     * arrived is the point.
     */
    const markSource =
      // A reward is not a coin arriving. The USDC mark put it in the column
      // with every other deposit, which is the one thing this row is not.
      isVoucher
        ? require("@/assets/images/gift-card.png")
        : metadata?.source === "business_settlement"
          ? require("@/assets/images/store.png")
        : type === "TRANSFER_OUT"
          ? require("@/assets/images/user.png")
          : type === "WITHDRAW"
            ? // A business paid from the wallet is a shop, not a send.
              metadata?.payee
              ? require("@/assets/images/store.png")
              : require("@/assets/images/send.png")
            : null;
    return (
      <Wrapper {...wrapperProps} style={styles.container}>
        {markSource ? (
          <View style={styles.markSlot}>
            <Image
              source={markSource}
              style={[styles.billGlyph, { tintColor: discMark }]}
            />
          </View>
        ) : (
          <TokenLogo symbol={isRouted && sentSymbol ? sentSymbol : asset} size={36} dark />
        )}

        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text style={[styles.payee, { color: colors.foreground }]} numberOfLines={1}>
              {/* Deposits name the asset; the rest already describe themselves
                  ("Withdrew USDC", "Sent to @soke"). A routed one names what
                  was sent - "USDC Deposit" on a row the person paid for in
                  Bitcoin is the one thing they would not recognise. */}
              {isVoucherClaim
                ? "Voucher claimed"
                : type === "DEPOSIT" && metadata?.source === "business_settlement"
                  ? getLabel()
                  : type === "DEPOSIT"
                  ? `${isRouted && sentSymbol ? sentSymbol : label} Deposit`
                  : getLabel()}
            </Text>
            {titleMark}
          </View>
          {/* A conversion says so with the mark rather than the words. "Converted
              to USDC" spent most of a narrow line restating what the title and
              the amount already carry between them - the row reads USDT above
              and a USDC figure to the right, so the only thing left to say is
              that one became the other. The mark says it in a glyph, and what
              it became stays beside it. */}
          {isRouted ? (
            <View style={styles.metaRow}>
              <Image
                source={require("@/assets/images/alter.png")}
                style={[styles.metaMark, { tintColor: colors.mutedForeground }]}
              />
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {`${label} · ${whenStr}`}
              </Text>
            </View>
          ) : (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {isVoucherClaim
                ? `Reward · ${whenStr}`
                : chain
                  ? `${CHAIN_NAMES[chain] || chain} · ${whenStr}`
                  : whenStr}
            </Text>
          )}
        </View>

        <View style={styles.right}>
          <Text
            style={[
              styles.payeeAmount,
              {
                color: routedPending
                  ? colors.mutedForeground
                  : isPositive
                    ? AMOUNT_IN
                    : colors.foreground,
              },
              status === "FAILED" && styles.struck,
            ]}
          >
            {/*
              The figure and its unit are not the same thing.
              Set as one string they made a ragged right edge - every row a
              different width of white - and the number, which is what anybody
              is scanning for, had to be picked out of it. The ticker drops
              back a shade and the figures run in tabular digits, so the column
              lines up down the page.
            */}
            {routedPending && sentAmount ? (
              <>
                {sentAmount}
                <Text style={[styles.unit, { color: colors.mutedForeground }]}> {sentSymbol}</Text>
              </>
            ) : (
              <>
                {isPositive ? "+" : "-"}{tokenAmount}
                <Text style={[styles.unit, { color: colors.mutedForeground }]}> {label}</Text>
              </>
            )}
          </Text>
          {status !== "COMPLETED" && (
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor() + "22" }]}>
              <Text style={[styles.statusText, { color: getStatusColor() }]}>{statusLabel}</Text>
            </View>
          )}
        </View>
      </Wrapper>
    );
  }

  if (isNairaBuy) {
    return (
      <Wrapper {...wrapperProps} style={styles.container}>
        <TokenLogo symbol={asset} size={36} dark />

        <View style={styles.info}>
          <Text
            style={[styles.payee, styles.figureTitle, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {/* The figure leads here too: on a funding row the token amount
                IS the title, and the ticker is the unit on it. */}
            {tokenAmount}
            <Text style={[styles.unit, { color: colors.mutedForeground }]}> {label}</Text>
          </Text>
          {/* "Funded", not "Deposit" - a deposit is crypto arriving from
              outside, and that row now says so in its own title. This one is
              naira turning into crypto, which is a different event. */}
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            Funded · {whenStr}
          </Text>
        </View>

        <View style={styles.right}>
          <Text
            style={[
              styles.payeeAmount,
              { color: AMOUNT_IN },
              status === "FAILED" && styles.struck,
            ]}
          >
            {`+ ${fmtNaira(metadata.amountNaira)}`}
          </Text>
          {status !== "COMPLETED" && (
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor() + "22" }]}>
              <Text style={[styles.statusText, { color: getStatusColor() }]}>{statusLabel}</Text>
            </View>
          )}
        </View>
      </Wrapper>
    );
  }

  if (isBankPayout) {
    return (
      <Wrapper {...wrapperProps} style={styles.container}>
        {/* The bank's own logo when we have one. These are supplied on white,
            so the disc stays white in both themes rather than taking the
            foreground colour - tinting it would clip the logo's own colours.
            Banks without a logo fall back to the glyph on a themed disc. */}
        {bankLogo ? (
          <View style={[styles.bankIcon, styles.bankLogoDisc]}>
            <Image source={bankLogo} style={styles.bankLogoImg} resizeMode="contain" />
          </View>
        ) : (
          <View style={[styles.bankIcon, { backgroundColor: colors.foreground }]}>
            <MaterialIcons name="account-balance" size={18} color={colors.background} />
          </View>
        )}

        <View style={styles.info}>
          <Text style={[styles.payee, { color: colors.foreground }]} numberOfLines={1}>
            {/* Their name as a name. Upper-cased it was the loudest thing on a
                screen full of quieter rows, and a bank's own record of it is
                already shouting. */}
            {titleCase(payeeName!)}
          </Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {metadata?.bankName ? `${metadata.bankName} · ${whenStr}` : `Bank · ${whenStr}`}
          </Text>
        </View>

        <View style={styles.right}>
          <Text
            style={[
              styles.payeeAmount,
              { color: colors.foreground },
              // A failed payout is struck through rather than coloured: the
              // money did not move, so the figure is a record, not a total.
              status === "FAILED" && styles.struck,
            ]}
          >
            {/* Space after the sign: "- ₦68,050.00". Butted up against the
                naira mark the minus reads as part of the symbol. */}
            {`- ${fmtNaira(nairaAmount!)}`}
          </Text>
          {status !== "COMPLETED" && (
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor() + "22" }]}>
              <Text style={[styles.statusText, { color: getStatusColor() }]}>{statusLabel}</Text>
            </View>
          )}
        </View>
      </Wrapper>
    );
  }

  return (
    <Wrapper {...wrapperProps} style={styles.container}>
      <View style={styles.iconWrap}>
        {(type === "LOCK" || type === "SAVINGS_LOCK" || type === "UNLOCK" || type === "SAVINGS_WITHDRAW") ? (
          <View style={[styles.lockIcon, { backgroundColor: (type === "LOCK" || type === "SAVINGS_LOCK") ? "#f59e0b22" : "#22c55e22" }]}>
            <Feather name={(type === "LOCK" || type === "SAVINGS_LOCK") ? "lock" : "unlock"} size={22} color={(type === "LOCK" || type === "SAVINGS_LOCK") ? "#f59e0b" : "#22c55e"} />
          </View>
        ) : (
          <>
            <TokenLogo symbol={asset} size={36} />
            {chain && CHAIN_LOGOS[chain] && (
              <View style={[styles.iconBadge, { backgroundColor: colors.card }]}>
                <Image source={CHAIN_LOGOS[chain]} style={styles.chainImg} resizeMode="cover" />
              </View>
            )}
          </>
        )}
      </View>
      <View style={styles.info}>
        <Text style={[styles.label, { color: colors.foreground }]} numberOfLines={1}>
          {getLabel()}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          {whenStr}
        </Text>
      </View>
      <View style={styles.right}>
        <Text
          style={[
            styles.amount,
            { color: isPositive ? AMOUNT_IN : colors.foreground },
          ]}
        >
          {isPositive ? "+" : "-"}
          {amount.toFixed(asset === "ETH" ? 8 : asset === "MOVE" ? 2 : 4)}
          {/* The ticker drops back a shade, as it does on the payee rows
              above. Set in the same weight and colour as the figure it
              competed with the number, which is the thing anybody is
              scanning a list like this for. */}
          <Text style={[styles.unit, { color: colors.mutedForeground }]}> {label}</Text>
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor() + "22" }]}>
          <Text style={[styles.statusText, { color: getStatusColor() }]}>
            {statusLabel}
          </Text>
        </View>
      </View>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    // No divider. The rows are already separated by their own spacing, and a
    // rule between every one turns a list into a table.
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    position: "relative",
  },
  lockIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "transparent",
    overflow: "hidden",
  },
  chainImg: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  bankIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  // The mark sits with the title rather than after the whole line, so it
  // does not drift to the far edge when the name is short.
  titleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  info: {
    flex: 1,
    gap: 2,
  },
  payee: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: "Inter_600SemiBold",
    // Tightened from +0.2. Positive tracking on a semibold face at this size
    // reads as a caption stretched to fit, not as a name.
    letterSpacing: -0.15,
    includeFontPadding: false,
  },
  payeeAmount: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: -0.2,
    fontVariant: ["tabular-nums"],
  },
  // The ticker beside a figure, a step down and a shade back. It is the unit,
  // not the news.
  unit: { fontSize: 12.5, fontFamily: "Inter_500Medium" },
  /** A title that is a number gets the column's digits. */
  figureTitle: { fontVariant: ["tabular-nums"] },
  struck: { textDecorationLine: "line-through" },
  // The slot keeps the leading column the width of a token logo, so rows with
  // a mark and rows with a logo still line up down the page.
  markSlot: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  billGlyph: { width: 21, height: 21, resizeMode: "contain" },
  boltGlyph: { width: 23, height: 23 },
  bankLogoDisc: { backgroundColor: "#ffffff", overflow: "hidden" },
  bankLogoImg: { width: 26, height: 26 },
  label: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    includeFontPadding: false,
  },
  meta: {
    fontSize: 11.5,
    fontFamily: "Inter_400Regular",
    includeFontPadding: false,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  // Sized to the cap height of the line beside it rather than its full size,
  // so the glyph sits on the text rather than looming over it.
  metaMark: { width: 10, height: 10, resizeMode: "contain" },
  /**
   * The column that must not move.
   *
   * flexShrink defaults to 1, so when a long label and a long figure together
   * overran the row, this was squeezed and the amount wrapped - which is what
   * put "-101.1401 cNGN" on a different right edge from "-200 cNGN". It keeps
   * its width now and the label truncates instead, which is the one of the two
   * that can afford to.
   */
  right: {
    alignItems: "flex-end",
    gap: 4,
    flexShrink: 0,
  },
  amount: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    // So a figure that does wrap stays on the edge it was aligned to.
    textAlign: "right",
    includeFontPadding: false,
    fontVariant: ["tabular-nums"],
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    borderRadius: 5,
  },
  statusText: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    includeFontPadding: false,
  },
});
