import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, Platform, Modal, Alert, StyleSheet, Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { TokenLogo } from "@/components/TokenLogo";
import { ts, TOKEN_NETWORKS, onChainAsset, CHAIN_MARKS, TokenSymbol, NetworkInfo, MIN_WITHDRAW, isSendable } from "@/constants/transfer";

/**
 * Withdrawal token list. Native USDC on Movement is held as USDCx.
 *
 * Hidden for now, and both are one line away from returning:
 *   { id: "USDCe", label: "USDC (old)", logo: "USDC", networks: [{ name: "Movement", tag: "MOVE" }] }
 *   { id: "SOL", label: "SOL", logo: "SOL", networks: TOKEN_NETWORKS.SOL }
 *
 * Note what hiding USDC.e costs: this was the only screen that still offered
 * the legacy bridged asset, so anyone holding a USDC.e balance now has no way
 * to move it from inside the app.
 */
type WToken = { id: string; label: string; logo: TokenSymbol; networks: NetworkInfo[] };
const WITHDRAW_TOKENS: WToken[] = [
  { id: "USDC", label: "USDC", logo: "USDC", networks: TOKEN_NETWORKS.USDC },
  { id: "USDT", label: "USDT", logo: "USDT", networks: TOKEN_NETWORKS.USDT },
  { id: "MOVE", label: "MOVE", logo: "MOVE", networks: TOKEN_NETWORKS.MOVE },
  { id: "cNGN", label: "cNGN", logo: "cNGN", networks: TOKEN_NETWORKS.cNGN },
];

// On-chain asset key for a withdraw token id on a given chain.
const wAsset = (id: string, chain: string): string =>
  id === "USDCe" ? "USDC" : onChainAsset(id, chain);

export default function WithdrawSelectScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { walletBalances, walletReady } = useApp();

  useEffect(() => {
    if (!walletReady) {
      Alert.alert("Wallet Required", "Create your wallet first to withdraw crypto.", [{ text: "OK", onPress: () => router.back() }]);
    }
  }, [walletReady]);
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [selectedToken, setSelectedToken] = useState<WToken | null>(null);
  const [showNetworkSheet, setShowNetworkSheet] = useState(false);

  const networkBalance = (id: string, chain: string) => {
    const entry = walletBalances.find(b => b.asset === wAsset(id, chain) && b.chain === chain);
    return entry?.balance ?? 0;
  };

  const tokenBalance = (t: WToken) =>
    t.networks.reduce((s, n) => s + networkBalance(t.id, n.tag), 0);

  /**
   * The chains this token is actually held on, biggest balance first.
   *
   * Declaration order is a fact about the constant, not about the money: it
   * put Movement's eight dollars above Arc's thirty-nine, so the chain
   * somebody most likely meant was the second one down. Sorting by what is
   * there makes the first row the usual answer.
   *
   * Declared after networkBalance on purpose: both are const arrow functions,
   * so reading this above them evaluates against an undefined binding.
   */
  const fundedNetworks = selectedToken
    ? selectedToken.networks
        .filter((net) =>
          isSendable(net.tag, networkBalance(selectedToken.id, net.tag),
            MIN_WITHDRAW[selectedToken.id] ?? 0.01),
        )
        .sort(
          (a, b) =>
            networkBalance(selectedToken.id, b.tag) - networkBalance(selectedToken.id, a.tag),
        )
    : [];

  const handleTokenTap = (t: WToken) => {
    if (t.networks.length === 1) {
      router.push({
        pathname: "/withdraw-detail",
        params: { token: t.id, label: t.label, network: t.networks[0].tag, networkName: t.networks[0].name },
      } as any);
    } else {
      setSelectedToken(t);
      setShowNetworkSheet(true);
    }
  };

  const handleNetworkSelect = (net: NetworkInfo) => {
    setShowNetworkSheet(false);
    router.push({
      pathname: "/withdraw-detail",
      params: { token: selectedToken!.id, label: selectedToken!.label, network: net.tag, networkName: net.name },
    } as any);
  };

  return (
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={ts.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[ts.headerTitle, { color: colors.foreground }]}>Send Crypto</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* No verification gate here. Sending crypto moves the user's own tokens
          out of a wallet their device signs for; there is no payout rail to
          regulate, and the API does not gate it either. Verification is for
          the naira side. */}
      <ScrollView contentContainerStyle={{ paddingBottom: bottomPad + 20 }}>
        {/* One card per token, each its own surface with air between them.
            The prompt above the list is gone: a screen titled "Send Crypto"
            showing four coins does not need to be told it is a list of coins. */}
        <View style={w.list}>
          {WITHDRAW_TOKENS.map((t) => {
            const bal = tokenBalance(t);
            const dec = t.id === "SOL" ? 4 : 2;
            return (
              <TouchableOpacity
                key={t.id}
                style={[w.card, { backgroundColor: colors.card }]}
                onPress={() => handleTokenTap(t)}
                activeOpacity={0.75}
              >
                <TokenLogo symbol={t.logo} size={38} />
                <Text style={[w.name, { color: colors.foreground }]}>{t.label}</Text>
                {/* Balance rides on the same line rather than under the name:
                    it keeps the row a single band of text, which is what makes
                    the spacing read as generous rather than merely tall. */}
                <Text style={[w.bal, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {bal.toFixed(dec)}
                </Text>
                <Feather name="chevron-right" size={19} color={colors.mutedForeground} />
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Network selector modal */}
      {showNetworkSheet && selectedToken && (
        <Modal transparent animationType="slide" visible>
          <TouchableOpacity style={ts.modalOverlay} activeOpacity={1} onPress={() => setShowNetworkSheet(false)}>
            <View
              style={[ts.bankSheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 20 }]}
              onStartShouldSetResponder={() => true}
            >
              <View style={[ts.handle, { alignSelf: "center", backgroundColor: colors.primary }]} />

              <View style={w.sheetHead}>
                {/* The monochrome mark, which brings its own disc - the hand
                    rolled tinted circle underneath it was a second disc. */}
                <TokenLogo symbol={selectedToken.logo} size={46} dark />
                <Text style={[w.sheetTitle, { color: colors.foreground }]}>Select network</Text>
              </View>

              <View style={w.netList}>
                {/* Only chains actually holding this token. An empty chain is
                    not a choice - offering it just to grey it out made the
                    list longer without making it more useful. */}
                {fundedNetworks.length === 0 && (
                  <Text style={[w.netEmpty, { color: colors.mutedForeground }]}>
                    No {selectedToken.label} on any network yet.
                  </Text>
                )}
                {fundedNetworks.map((net) => {
                  const netBal = networkBalance(selectedToken.id, net.tag);
                  const dec = selectedToken.id === "SOL" ? 4 : 2;
                  return (
                    <TouchableOpacity
                      key={net.tag}
                      // Nothing to send from an empty chain. Dimmed rather than
                      // hidden, so the list does not change shape between
                      // tokens and you can see the chain exists.
                      style={[w.netRow, { backgroundColor: colors.background }]}
                      onPress={() => handleNetworkSelect(net)}
                      activeOpacity={0.75}
                    >
                      {CHAIN_MARKS[net.tag] ? (
                        <Image source={CHAIN_MARKS[net.tag]} style={w.netMark} />
                      ) : (
                        <View style={[w.netMark, { backgroundColor: colors.muted }]} />
                      )}
                      <Text style={[w.netName, { color: colors.foreground }]}>{net.name}</Text>
                      <Text style={[w.netBal, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {netBal.toFixed(dec)}
                      </Text>
                      <Feather name="chevron-right" size={19} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}

/** This screen's own list. The shared ts.tokenRow had no other caller. */
const w = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingTop: 10, gap: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    // Taller than it needs to be, on purpose: the height is what separates
    // these from a settings list.
    height: 66,
    borderRadius: 18,
  },
  name: { flex: 1, fontSize: 16, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  bal: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_500Medium" },

  sheetHead: { alignItems: "center", paddingTop: 4, paddingBottom: 22 },
  sheetTitle: {
    fontSize: 21,
    lineHeight: 27,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.5,
    marginTop: 14,
  },
  netList: { gap: 10 },
  netEmpty: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 26 },
  // Sits on the background rather than the card, so each row reads as a well
  // cut into the sheet instead of a box drawn on it.
  netRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingHorizontal: 14,
    height: 62,
    borderRadius: 16,
  },
  netMark: { width: 30, height: 30, borderRadius: 15 },
  netName: { flex: 1, fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  netBal: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_500Medium" },
});
