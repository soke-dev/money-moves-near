import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { TokenLogo } from "@/components/TokenLogo";
import { TOKEN_NETWORKS, TokenSymbol } from "@/constants/transfer";
import {
  getRoutedDeposits,
  groupRouted,
  type RoutedGroup,
} from "@/services/routed-deposits";

/**
 * Tokens that land as themselves.
 *
 * Send USDC, hold USDC. Nothing is converted, so the only question is which
 * chain it arrives on - which is what the network sheet asks for the ones that
 * exist on more than one.
 */
/** Converted at the door: Bitcoin in the main list, Tron USDT under USDT. */
/**
 * What stays under Other crypto. USDC and USDT on Ethereum and Arbitrum are
 * networks in those coins' own dropdowns now, and ETH on Arbitrum is not
 * offered, so Arbitrum drops out of this list entirely.
 */
const inOtherCrypto = (a: { chainId: number; symbol: string }) =>
  a.chainId !== 42161 && !(a.chainId === 1 && (a.symbol === "USDC" || a.symbol === "USDT"));
const BTC_CHAIN = 10001;
const TRON_CHAIN = 728126428;

const DIRECT = [
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "USDT", name: "Tether" },
  { symbol: "MOVE", name: "Movement" },
];

/**
 * Tokens we do not hold, which are converted on the way in.
 *
 * The list comes from the server rather than from here, because which ones are
 * offered is a switch somebody throws in the console - and because each row
 * needs the address and the minimum that belong to this particular account.
 * Until it answers, the section is simply absent: an empty heading over
 * nothing reads as breakage, where no heading reads as a screen that has not
 * finished loading.
 */

export default function SelectCryptoScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [converted, setConverted] = useState<RoutedGroup[] | null>(null);
  // Bitcoin is drawn in the main list and Tron USDT inside USDT's network list,
  // so "Other crypto" holds everything else.
  const btc = converted?.find((g) => g.chainId === BTC_CHAIN);
  const others = converted?.filter((g) => g.chainId !== BTC_CHAIN && g.chainId !== TRON_CHAIN) ?? null;

  /**
   * Asked once, and quietly.
   *
   * The first call for an account creates its deposit addresses, so it is
   * slower than the rest of this screen. A failure leaves the section out
   * rather than showing an error - the four tokens above still work, and
   * nothing here is what the person came for.
   */
  useEffect(() => {
    getRoutedDeposits()
      // Grouped by address: Ethereum USDC and USDT are one place to send to,
      // and two rows said there were two.
      .then((d) => setConverted(groupRouted((d.assets ?? []).filter(inOtherCrypto))))
      .catch((e) => {
        // Quiet for the person, loud for us. Hiding the section on failure is
        // right in production and invisible while building it - the first run
        // against a backend without these routes looked like an empty list.
        if (__DEV__) console.warn("[routed] could not load:", e?.response?.status, e?.message);
        setConverted([]);
      });
  }, []);
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  /**
   * Straight to the address, on the token's first network.
   *
   * Asking for a chain here made picking a token a two-step decision before
   * anything was on screen. The deposit screen already carries a network row
   * that opens the same list, so the choice is still one tap away - it is just
   * made next to the address it changes, where its consequence is visible.
   */
  const handleCryptoTap = (symbol: string) => {
    const networks = TOKEN_NETWORKS[symbol as TokenSymbol];
    router.push({
      pathname: "/deposit",
      params: { crypto: symbol, network: networks[0].tag },
    } as any);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Title and its line of explanation sit together in the centre, with the
          back button floated beside them - a two-line header cannot be balanced
          by a single arrow on one side. */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground }]}>Add money</Text>
          <Text style={[styles.titleSub, { color: colors.mutedForeground }]}>
            Pick what you are sending
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Rail
          colors={colors}
          title="Deposit crypto"
        />

        {DIRECT.map((c) => (
          <React.Fragment key={c.symbol}>
            <TouchableOpacity
              style={[styles.row, { backgroundColor: colors.card }]}
              activeOpacity={0.75}
              onPress={() => handleCryptoTap(c.symbol)}
            >
              {/* The coin's own colours: a list of grey marks read as disabled. */}
              <TokenLogo symbol={c.symbol} size={34} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>{c.symbol}</Text>
                <Text style={[styles.rowNote, { color: colors.mutedForeground }]}>{c.name}</Text>
              </View>
              <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
            </TouchableOpacity>

            {/* Bitcoin sits with the coins people come here for, under USDT. It
                still converts: its own screen says so, with its address. */}
            {c.symbol === "USDT" && (converted === null || btc) && (
              <TouchableOpacity
                style={[styles.row, { backgroundColor: colors.card }, btc && !btc.available && styles.rowOff]}
                activeOpacity={0.75}
                disabled={!btc || !btc.available}
                onPress={() =>
                  router.push({ pathname: "/deposit-routed", params: { chainId: String(BTC_CHAIN) } } as any)
                }
              >
                <TokenLogo symbol="BTC" size={34} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>BTC</Text>
                  <Text
                    style={[styles.rowNote, { color: btc && !btc.available ? colors.warning : colors.mutedForeground }]}
                    numberOfLines={1}
                  >
                    {btc && !btc.available ? "Currently unavailable" : "Bitcoin · settles as USDC"}
                  </Text>
                </View>
                {btc?.available ? (
                  <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
                ) : !btc ? (
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                ) : null}
              </TouchableOpacity>
            )}
          </React.Fragment>
        ))}

        {/* Always there: cNGN is in it whatever the converted list says. */}
        <Rail colors={colors} title="Other crypto" gap />

        {/* cNGN first. It arrives as itself, on its own deposit screen; it sits
            here rather than with the main coins because few people send it.
            Receivable so it can be sold: a token you cannot be sent is a token
            you cannot off-ramp. */}
        <TouchableOpacity
          style={[styles.row, { backgroundColor: colors.card }]}
          activeOpacity={0.75}
          onPress={() => handleCryptoTap("cNGN")}
        >
          <TokenLogo symbol="cNGN" size={34} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>cNGN</Text>
            <Text style={[styles.rowNote, { color: colors.mutedForeground }]}>Naira stablecoin</Text>
          </View>
          <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
        </TouchableOpacity>

        {others === null ? (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          </View>
        ) : (
          others.map((c) => (
            <TouchableOpacity
              key={c.chainId}
              style={[styles.row, { backgroundColor: colors.card }, !c.available && styles.rowOff]}
              activeOpacity={0.75}
              // Drawn, named, and inert. Disabled rather than absent, because
              // a row that vanishes answers "is this gone for good?" with
              // silence.
              disabled={!c.available}
              onPress={() =>
                router.push({
                  pathname: "/deposit-routed",
                  params: { chainId: String(c.chainId) },
                } as any)
              }
            >
              {/* The CHAIN's mark, in colour. Tether on Tron and Tether on
                  Ethereum are the same token logo and completely different
                  money, so the network is the thing to get right. */}
              <TokenLogo symbol={c.logo} size={34} />

              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>
                  {c.label}
                </Text>
                <Text
                  style={[
                    styles.rowNote,
                    { color: c.available ? colors.mutedForeground : colors.warning },
                  ]}
                  numberOfLines={1}
                >
                  {/* The network only. Where it lands is on the deposit screen
                      it opens, which says "Arrives as USDC on ..." in full. */}
                  {c.available ? `${c.note} · settles as USDC` : "Currently unavailable"}
                </Text>
              </View>
              {c.available && (
                <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
              )}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

/**
 * A section heading that is a rule with a name on it.
 *
 * Two bold headings the same size as the rows they sat above made the screen
 * read as one undifferentiated list. A hairline carries the break; the label
 * is small and quiet because it is a signpost, not content.
 */
/**
 * A section heading: what it is, then what happens to it.
 *
 * The title names the group and the line under it names the outcome, which is
 * the entire distinction on this screen. Two headings that both ended "in your
 * wallet" described the part they had in common and left nine identical rows
 * to carry the difference.
 *
 * The glyph sits only on the half where something is swapped. A mark on both
 * would say both halves were notable; the quiet one is what the other is
 * measured against.
 */
function Rail({
  colors,
  title,
  sub,
  icon,
  gap,
}: {
  colors: any;
  title: string;
  sub?: string;
  icon?: boolean;
  gap?: boolean;
}) {
  return (
    <View style={[styles.rail, gap && styles.railGap]}>
      <View style={styles.railLine}>
        <Text style={[styles.railTitle, { color: colors.foreground }]}>{title}</Text>
        {icon && (
          <Image
            source={require("@/assets/images/alter.png")}
            // The text colour, not the accent - it reads as part of the
            // heading rather than as a badge stuck beside it. Following
            // foreground also keeps it visible on the light theme, where a
            // hardcoded white would vanish.
            style={[styles.railIcon, { tintColor: colors.foreground }]}
          />
        )}
      </View>
      {!!sub && <Text style={[styles.railSub, { color: colors.mutedForeground }]}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { justifyContent: "center", paddingVertical: 12, marginBottom: 12 },
  back: { position: "absolute", left: 20, zIndex: 1 },
  headerText: { alignItems: "center", paddingHorizontal: 56 },
  title: { fontSize: 18, lineHeight: 23, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  titleSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 2 },

  list: { paddingHorizontal: 16 },

  rail: { marginBottom: 13 },
  railGap: { marginTop: 28 },
  railLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  railIcon: { width: 14, height: 14, resizeMode: "contain" },
  railTitle: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  railSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 3 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 16,
    marginBottom: 9,
  },
  // The outcome, trailing the row rather than crowding the chain's own mark.
  // Smaller than that mark on purpose: the chain is the choice being made and
  // the thing that has to be right, this is only what it turns into.
  outcome: { flexDirection: "row", alignItems: "center", gap: 5, marginRight: 2 },
  outcomeSwap: { width: 11, height: 11, resizeMode: "contain" },
  // Dimmed but still listed - the answer to "can I send this?" is "not right
  // now", which an absent row cannot give. Not so faint that the name stops
  // being readable: the point is that it can be found.
  rowOff: { opacity: 0.55 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { fontSize: 14.5, lineHeight: 19, fontFamily: "Inter_600SemiBold", letterSpacing: -0.2 },
  rowNote: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 2 },
  soon: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_500Medium" },
  loading: { paddingVertical: 22, alignItems: "center" },

});
