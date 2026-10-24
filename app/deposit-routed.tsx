import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";
import { useColors } from "@/hooks/useColors";
import { TokenLogo } from "@/components/TokenLogo";
import {
  getRoutedDeposits,
  getRoutedActivity,
  groupRouted,
  ROUTED_CHAIN_NAME,
  type RoutedGroup,
} from "@/services/routed-deposits";

/**
 * Send one thing, receive another.
 *
 * The address on this screen is not the person's wallet - it belongs to the
 * converting rail, and what they send is swapped and delivered to their own
 * wallet as USDC: on Solana for Bitcoin and Tron, on Movement for the rest.
 * That is the one fact the screen has to get across, because every other
 * deposit screen in the app means the opposite.
 *
 * So the conversion is stated above the address rather than below it, in the
 * place somebody looks before they copy anything.
 */
export default function RoutedDepositScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // A chain, not a token. One address takes everything the chain carries.
  const params = useLocalSearchParams<{ chainId?: string }>();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [groups, setGroups] = useState<RoutedGroup[] | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getRoutedDeposits()
      .then((d) => setGroups(groupRouted(d.assets ?? [])))
      .catch((e: any) =>
        setError(e?.response?.data?.error || "Could not load that deposit address."),
      );
  }, []);

  /**
   * Asked for once, for its side effect rather than its answer.
   *
   * Nothing on this screen draws the result any more - progress belongs in the
   * transaction list, beside everything else that has happened to the person's
   * money, rather than on the screen they only opened to copy an address.
   *
   * The call stays because reading the provider is what writes those rows: it
   * is how a deposit made minutes ago is already in the list by the time
   * somebody goes looking for it.
   */
  useEffect(() => {
    getRoutedActivity().catch(() => {});
  }, []);

  const group = useMemo(() => {
    if (!groups) return null;
    const chainId = Number(params.chainId);
    return groups.find((g) => g.chainId === chainId) ?? null;
  }, [groups, params.chainId]);

  const copy = async () => {
    if (!group) return;
    await Clipboard.setStringAsync(group.address);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const chainName = group ? ROUTED_CHAIN_NAME[group.chainId] ?? "" : "";
  const symbols = group ? group.assets.map((a) => a.symbol) : [];

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.back} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={s.headerText}>
          <Text style={[s.title, { color: colors.foreground }]}>
            {group ? group.label : "Deposit"}
          </Text>
          <Text style={[s.titleSub, { color: colors.mutedForeground }]}>
            {group ? `Arrives as USDC on ${group.settlesOn}` : "Loading"}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[s.body, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {error ? (
          <Text style={[s.error, { color: colors.destructive }]}>{error}</Text>
        ) : !groups ? (
          <View style={s.loading}>
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        ) : !group || !group.available ? (
          /* Not only when the chain is unknown. An asset switched to
             unavailable is still in the list and still has an address, so the
             screen behind the row has to refuse too - otherwise back-navigation
             or a stale route reaches it and somebody sends to an address
             nothing is watching. */
          <Text style={[s.error, { color: colors.mutedForeground }]}>
            That deposit is not available right now.
          </Text>
        ) : (
          <>
            {/* Said before the address, not after it. Somebody who copies first
                and reads later has already made the decision this explains. */}
            <View
              style={[
                s.converts,
                { backgroundColor: colors.primary + "0E", borderColor: colors.primary + "24" },
              ]}
            >
              <TokenLogo symbol={group.logo} size={20} />
              <Text style={[s.convertsName, { color: colors.foreground }]} numberOfLines={1}>
                {group.label}
              </Text>
              <View style={s.convertsFill} />
              <Feather name="arrow-right" size={14} color={colors.mutedForeground} />
              <View style={s.convertsFill} />
              <Text style={[s.convertsName, { color: colors.foreground }]}>USDC on {group.settlesOn}</Text>
              <TokenLogo symbol="USDC" size={20} />
            </View>

            <View style={[s.qrWrap, { backgroundColor: "#fff" }]}>
              <QRCode value={group.address} size={172} backgroundColor="#fff" />
            </View>

            <Text style={[s.label, { color: colors.mutedForeground }]}>
              {chainName} address
            </Text>
            <TouchableOpacity
              style={[s.addressBox, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={copy}
              activeOpacity={0.8}
            >
              <Text style={[s.address, { color: colors.foreground }]} selectable>
                {group.address}
              </Text>
              <Feather
                name={copied ? "check" : "copy"}
                size={17}
                color={copied ? "#22c55e" : colors.mutedForeground}
              />
            </TouchableOpacity>

            <View style={[s.notes, { borderColor: colors.border }]}>
              {/* One line per asset the address takes. The minimum is the
                  server's, per asset - below it a transfer is ignored rather
                  than credited, and nothing comes back. */}
              {group.assets.some((a) => a.minimum) && (
                <Note colors={colors} icon="alert-circle">
                  Send at least{" "}
                  {group.assets
                    .filter((a) => a.minimum)
                    .map((a, i, arr) => (
                      <Text key={a.symbol}>
                        <Text style={{ color: colors.foreground }}>
                          {a.minimum} {a.symbol}
                        </Text>
                        {i < arr.length - 1 ? (i === arr.length - 2 ? " or " : ", ") : ""}
                      </Text>
                    ))}
                  . Anything smaller is not credited.
                </Note>
              )}
              <Note colors={colors} icon="git-branch">
                {symbols.join(" or ")} on {chainName} only. Another network will not arrive.
              </Note>
              <Note colors={colors} icon="clock">
                {group.chainId === 10001
                  ? "Bitcoin waits for confirmations first, so this takes longer than other coins. "
                  : "Conversion takes a few minutes. "}
                The rate is whatever the market gives when it lands, so the amount will not match
                exactly.
              </Note>
              {/* Where it went, said on the screen they sent it from. Without
                  this the deposit disappears the moment they leave here. */}
              <Note colors={colors} icon="list">
                It shows up in your transactions as soon as we see it. Follow it from there.
              </Note>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Note({
  colors,
  icon,
  children,
}: {
  colors: any;
  icon: any;
  children: React.ReactNode;
}) {
  return (
    <View style={s.note}>
      <Feather name={icon} size={14} color={colors.mutedForeground} style={{ marginTop: 2 }} />
      <Text style={[s.noteText, { color: colors.mutedForeground }]}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 18 },
  back: { width: 40 },
  headerText: { flex: 1, alignItems: "center", marginRight: 40 },
  title: { fontSize: 19, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  titleSub: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 2 },

  body: { paddingHorizontal: 20 },
  loading: { paddingVertical: 60, alignItems: "center" },
  error: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 40 },

  // The two ends of the swap at the two ends of the row, with the arrow
  // floating between them. Both marks used to sit on the left with a sentence
  // after them, which left half the card empty and made the pair look like a
  // decoration rather than the trade.
  converts: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 20,
  },
  convertsName: {
    flexShrink: 1,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: -0.2,
  },
  convertsFill: { flex: 1, minWidth: 8 },

  qrWrap: { alignSelf: "center", padding: 14, borderRadius: 18, marginBottom: 22 },

  label: { fontSize: 11.5, fontFamily: "Inter_500Medium", marginBottom: 7 },
  addressBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  address: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium" },


  notes: { marginTop: 22, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, gap: 12 },
  note: { flexDirection: "row", gap: 9 },
  noteText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular" },
});
