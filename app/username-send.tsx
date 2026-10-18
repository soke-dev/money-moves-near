import React, { useState, useEffect, useMemo } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, TextInput, Platform, Modal, StyleSheet, Image,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { TokenLogo } from "@/components/TokenLogo";
import { ts, TOKENS, TOKEN_NETWORKS, assetLabel, onChainAsset, TokenSymbol, NetworkInfo, FONT_SCALE, MIN_SEND, isSendable } from "@/constants/transfer";

// Native Movement USDC is the USDCx asset, merged into "USDC" here. The legacy
// bridged USDC.e is not offered for username sends.
const SEND_TOKENS: TokenSymbol[] = TOKENS.filter((t) => t !== "USDCx");
import { Keypad } from "@/components/Keypad";
// CurrencyToggle went with the segmented switch; the type is still the
// currency the screen is typed in.
import { AmountCurrency } from "@/components/CurrencyToggle";
import * as Haptics from "expo-haptics";
import { recipientStellar } from "@/services/stellar";

const CHAIN_LOGOS: Record<string, any> = {
  MOVE: require("@/assets/images/movementnew.jpg"),
  BASE: require("@/assets/images/base logo.png"),
  SOL: require("@/assets/images/solana.png"),
  BEP20: require("@/assets/images/bsc logo.png"),
  ARC: require("@/assets/images/ARC.jpg"),
  TON: require("@/assets/images/toncoin.png"),
  STELLAR: require("@/assets/images/stellar.jpg"),
  MONAD: require("@/assets/images/monad.png"),
};

export default function UsernameSendScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { walletBalances, rates } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const params = useLocalSearchParams<{
    recipientId: string;
    recipientUsername: string;
    recipientName: string;
  }>();
  const recipientUsername = params.recipientUsername || "";
  const recipientName = params.recipientName || recipientUsername;

  const [selectedToken, setSelectedToken] = useState<TokenSymbol | null>(null);
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkInfo | null>(null);
  const [ngnAmount, setNgnAmount] = useState("");   // canonical NGN amount string
  const [display, setDisplay] = useState("");        // text shown in the input (NGN or USD)
  const [currency, setCurrency] = useState<AmountCurrency>("NGN");
  const [showTokenSheet, setShowTokenSheet] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");
  const [autoSelected, setAutoSelected] = useState(false);

  // NGN per 1 USD (USDC ≈ $1). 0 until rates load.
  const usdNgn = rates?.USDC?.ngn || 0;

  const setNgn = (ngn: string) => {
    setNgnAmount(ngn);
    setDisplay(currency === "USD" && usdNgn > 0 && ngn ? (Number(ngn) / usdNgn).toFixed(2) : ngn);
  };

  /**
   * Keypad input, with the decimal rules the field used to get from the OS.
   *
   * A decimal-pad TextInput enforced none of this - it accepted a second
   * point and any number of places, and the value was cleaned up later.
   */
  const handleAmountKey = (key: string) => {
    if (key === ".") {
      if (display.includes(".")) return;
      handleAmountInput(display ? display + "." : "0.");
      return;
    }
    const next = display + key;
    const frac = next.split(".")[1];
    // Kobo, or cents. A third place is not a smaller amount.
    if (frac && frac.length > 2) return;
    handleAmountInput(/^0[0-9]/.test(next) ? next.slice(1) : next);
  };

  const handleAmountInput = (t: string) => {
    const clean = t.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    setDisplay(clean);
    if (currency === "NGN") {
      setNgnAmount(clean);
    } else {
      setNgnAmount(usdNgn > 0 && clean ? (Number(clean) * usdNgn).toFixed(2) : "");
    }
  };

  const handleCurrencyChange = (next: AmountCurrency) => {
    if (next === currency || usdNgn <= 0) return;
    setCurrency(next);
    if (!ngnAmount) { setDisplay(""); return; }
    setDisplay(next === "USD" ? (Number(ngnAmount) / usdNgn).toFixed(2) : ngnAmount);
  };

  const tokenBalance = (sym: TokenSymbol) => {
    return walletBalances
      .filter((b) => b.asset === sym || (sym === "USDC" && b.asset === "USDCx"))
      .reduce((sum, b) => sum + (b.balance ?? 0), 0);
  };

  const networkBalance = (token: string, chain: string) => {
    const entry = walletBalances.find((b) => b.asset === onChainAsset(token, chain) && b.chain === chain);
    return entry?.balance ?? 0;
  };

  const tokenDecimals = (sym: TokenSymbol) => (sym === "ETH" ? 8 : sym === "MOVE" ? 2 : 4);

  /**
   * Every holding, flattened to one row each.
   *
   * The picker used to ask for a token and then, in a second sheet, which
   * network it was on - two taps and two decisions for what is really one
   * choice: which pile of money to send from. Flattening also lets each row
   * carry its own balance, so a network holding nothing is simply absent
   * rather than offered and then rejected.
   */
  const sendOptions = useMemo(() => {
    const out: {
      key: string;
      token: TokenSymbol;
      chain: NetworkInfo;
      balance: number;
      ngn: number;
    }[] = [];

    for (const sym of SEND_TOKENS) {
      for (const net of TOKEN_NETWORKS[sym] || []) {
        const balance = networkBalance(sym, net.tag);
        // Not "more than zero": a chain holding dust prints as 0.0000 and
        // cannot be sent, so it is a row that looks like a choice and is not.
        if (!isSendable(net.tag, balance, MIN_SEND[sym] ?? 0.01)) continue;
        const ngn = balance * ((rates as any)?.[sym]?.ngn || 0);
        out.push({ key: `${sym}-${net.tag}`, token: sym, chain: net, balance, ngn });
      }
    }
    // Biggest first: the one most likely to be picked needs no scrolling.
    return out.sort((a, b) => b.ngn - a.ngn);
  }, [walletBalances, rates]);

  const filteredOptions = assetSearch.trim()
    ? sendOptions.filter((o) =>
        `${assetLabel(o.token)} ${o.chain.name}`
          .toLowerCase()
          .includes(assetSearch.trim().toLowerCase()),
      )
    : sendOptions;

  /**
   * Which coins the recipient can take on Stellar, or null while unknown.
   *
   * A Stellar account has to be opened, coin by coin, by its owner before
   * anything can land in it, so a holding there may be one this person cannot
   * receive. Asked only when there is a Stellar row to ask about, and an
   * unknown answer leaves every row as it is - prepare checks again anyway.
   */
  const [recipientStellarOk, setRecipientStellarOk] = useState<Record<string, boolean> | null>(null);
  const holdsStellar = sendOptions.some((o) => o.chain.tag === "STELLAR");
  useEffect(() => {
    if (!holdsStellar || !params.recipientId || recipientStellarOk) return;
    let live = true;
    recipientStellar(params.recipientId)
      .then((r) => {
        if (live && r.known) setRecipientStellarOk({ USDC: r.USDC, USDT: r.USDT });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [holdsStellar, params.recipientId]);

  const stellarBlocked = (token: string, chain: string) =>
    chain === "STELLAR" && recipientStellarOk !== null && !recipientStellarOk[token];

  // The ones they can receive first; the rest stay listed, dimmed, so a
  // holding on the home screen is never simply missing here.
  const pickerOptions = [
    ...filteredOptions.filter((o) => !stellarBlocked(o.token, o.chain.tag)),
    ...filteredOptions.filter((o) => stellarBlocked(o.token, o.chain.tag)),
  ];

  /**
   * cNGN is typed in cNGN, not in naira.
   *
   * Everything else is priced through the dollar, and cNGN was too: at a
   * market price of ₦0.9887 a typed ₦100 became 101.14 tokens, and the
   * receipt said so. The discount is real, but it is real at the point of
   * sale - where the naira actually arrives - not between two people passing
   * the same token back and forth. Here one cNGN is one naira, which is the
   * only thing anyone holding a naira stablecoin expects it to be.
   *
   * The sell screen is untouched and still prices it at the market, so what
   * we pay out is still what it is worth.
   */
  const tokenRate =
    selectedToken === "cNGN"
      ? 1
      : selectedToken && rates
        ? ((rates[selectedToken as keyof typeof rates] as any)?.ngn || 0)
        : 0;
  const tokenAmount = tokenRate > 0 && Number(ngnAmount) > 0
    ? Number(ngnAmount) / tokenRate
    : 0;

  const handleTokenTap = (sym: TokenSymbol) => {
    setSelectedToken(sym);
    setNgnAmount("");
    setDisplay("");
    const nets = TOKEN_NETWORKS[sym];
    // The picker hands back a chain with the token, so there is nothing left
    // to ask for here.
    setSelectedNetwork(nets.length === 1 ? nets[0] : null);
  };


  // On open, default to the token with the highest USD-value balance and its
  // highest-balance chain — like the sell screen / bank transfer pre-fill.
  useEffect(() => {
    if (autoSelected || !rates || walletBalances.length === 0) return;
    let best: TokenSymbol | null = null;
    let bestUsd = 0;
    for (const sym of SEND_TOKENS) {
      const usd = tokenBalance(sym) * ((rates[sym as keyof typeof rates] as any)?.usd || 0);
      if (usd > bestUsd) { bestUsd = usd; best = sym; }
    }
    if (best) {
      setSelectedToken(best);
      const nets = TOKEN_NETWORKS[best];
      let bestNet = nets[0];
      let bestBal = 0;
      for (const n of nets) {
        const b = networkBalance(best, n.tag);
        if (b > bestBal) { bestBal = b; bestNet = n; }
      }
      setSelectedNetwork(bestNet);
    }
    setAutoSelected(true);
  }, [rates, walletBalances, autoSelected]);

  /**
   * Off a Stellar holding this person cannot receive.
   *
   * The pick above goes by balance alone and can land on one, and the answer
   * can arrive either side of it. Moves to the biggest holding they can
   * receive, the same coin first. With none, nothing is selected, and the
   * note under the card says why rather than leaving an empty card to puzzle
   * over. The naira amount is kept: it means the same on any network.
   */
  const [stellarNote, setStellarNote] = useState("");
  useEffect(() => {
    if (!selectedToken || !selectedNetwork || !stellarBlocked(selectedToken, selectedNetwork.tag)) return;
    const open = sendOptions.filter((o) => !stellarBlocked(o.token, o.chain.tag));
    const next = open.find((o) => o.token === selectedToken) ?? open[0];
    const coin = assetLabel(selectedToken);
    if (next) {
      setSelectedToken(next.token);
      setSelectedNetwork(next.chain);
      setStellarNote(
        `@${recipientUsername} can't receive ${coin} on Stellar yet, so we picked ${assetLabel(next.token)} on ${next.chain.name}.`,
      );
    } else {
      setSelectedToken(null);
      setSelectedNetwork(null);
      setStellarNote(
        `@${recipientUsername} can't receive ${coin} on Stellar yet, and you have nothing on another network to send.`,
      );
    }
  }, [recipientStellarOk, selectedToken, selectedNetwork, sendOptions]);

  const balance =
    selectedToken && selectedNetwork
      ? networkBalance(selectedToken, selectedNetwork.tag)
      : 0;

  const minAmount = selectedToken ? (MIN_SEND[selectedToken] ?? 0.01) : 0;
  const insufficientWallet = tokenAmount > 0 && tokenAmount > balance;
  const belowMinimum = tokenAmount > 0 && tokenAmount < minAmount;

  const canProceed =
    selectedToken &&
    selectedNetwork &&
    tokenAmount > 0 &&
    !insufficientWallet &&
    !belowMinimum;

  /** What the chosen holding is worth, which is what the chips divide up. */
  const ceiling = tokenRate > 0 ? Math.floor(balance * tokenRate) : 0;

  const handleProceed = () => {
    if (!canProceed) return;
    const dec = tokenDecimals(selectedToken!);
    router.push({
      pathname: "/username-send-summary",
      params: {
        recipientId: params.recipientId,
        recipientUsername,
        recipientName,
        token: onChainAsset(selectedToken!, selectedNetwork!.tag),
        chain: selectedNetwork!.tag,
        chainName: selectedNetwork!.name,
        amount: tokenAmount.toFixed(dec),
        ngnAmount,
      },
    } as any);
  };

  return (
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={ts.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        {/* Generic: the recipient is named on the amount card now, and the
            header saying it too was the same thing twice in a row. */}
        <Text style={[ts.headerTitle, { color: colors.foreground }]}>Send</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        {/* One column, in the shape the bank-transfer amount screen uses: who
            it goes to, the figure, the unit. It was two stacked cards with a
            segmented switch, a balance line and a MAX pill fighting for the
            same corner - four controls around a number that was the point. */}
        <View style={s.amountWrap}>
          <View style={[s.toChip, { backgroundColor: colors.card }]}>
            <View style={[s.toAvatar, { backgroundColor: colors.primary + "1F" }]}>
              <Text style={[s.toAvatarText, { color: colors.primary }]}>
                {(recipientName || recipientUsername || "?")[0].toUpperCase()}
              </Text>
            </View>
            <Text style={[s.toName, { color: colors.foreground }]} numberOfLines={1}>
              @{recipientUsername}
            </Text>
          </View>

          <View style={s.amountRow}>
            {currency === "USD" ? (
              <Text style={[s.amountSymbol, { color: display ? colors.foreground : colors.mutedForeground }]}>
                $
              </Text>
            ) : (
              /* A glyph, not a text character: the naira mark has a crossbar
                 the system font renders through the letter. */
              <Image
                source={require("@/assets/images/nairaiconnew.png")}
                style={[s.nairaGlyph, { tintColor: display ? colors.foreground : colors.mutedForeground }]}
              />
            )}
            <Text style={[s.amountValue, { color: display ? colors.foreground : colors.mutedForeground }]}>
              {display || "0"}
            </Text>
          </View>

          {/* One control rather than a value and a segmented switch beside it:
              a filled pill next to the figure made the unit the brightest
              thing on the screen, and "NGN | USD" never said that tapping
              converts what you have already typed. */}
          <TouchableOpacity
            style={[s.swap, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => handleCurrencyChange(currency === "NGN" ? "USD" : "NGN")}
            disabled={usdNgn <= 0}
            activeOpacity={0.75}
          >
            <Text style={[s.swapValue, { color: colors.mutedForeground }]}>
              {tokenAmount > 0 && selectedToken
                ? `≈ ${tokenAmount.toFixed(tokenDecimals(selectedToken))} ${assetLabel(selectedToken)}`
                : currency === "USD"
                  ? "≈ ₦0"
                  : "≈ $0.00"}
            </Text>
            <Text style={[s.swapDot, { color: colors.primary }]}>·</Text>
            <Text style={[s.swapTo, { color: colors.primary }]}>
              switch to {currency === "NGN" ? "USD" : "NGN"}
            </Text>
          </TouchableOpacity>

          {/* Fixed slot, so the layout does not jump when a limit is hit. */}
          <Text
            style={[
              s.amountErr,
              { color: belowMinimum || insufficientWallet ? colors.destructive : "transparent" },
            ]}
          >
            {insufficientWallet ? "Insufficient funds" : belowMinimum ? "Amount is too small" : " "}
          </Text>
        </View>
      </ScrollView>

      <View style={s.dock}>
        <View style={s.chips}>
          {/* Three amounts and the ceiling, in one row. One you cannot afford
              is dimmed rather than hidden, so the row does not reflow under
              your thumb as the balance moves. */}
          {[1000, 5000, 10000].map((q) => {
            const affordable = ceiling >= q;
            return (
              <TouchableOpacity
                key={q}
                style={[s.chip, { backgroundColor: colors.card, opacity: affordable ? 1 : 0.4 }]}
                disabled={!affordable}
                onPress={() => { Haptics.selectionAsync(); setNgn(String(q)); }}
                activeOpacity={0.8}
              >
                <Text style={[s.chipText, { color: colors.foreground }]}>
                  ₦{q.toLocaleString()}
                </Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[s.chip, { backgroundColor: colors.card, opacity: ceiling > 0 ? 1 : 0.4 }]}
            disabled={ceiling <= 0 || !selectedToken}
            onPress={() => {
              Haptics.selectionAsync();
              // Floored to the asset own precision first, so Max cannot ask for
              // a fraction of a token the chain will not move.
              const d = tokenDecimals(selectedToken!);
              const factor = 10 ** d;
              const maxToken = Math.floor(balance * factor) / factor;
              setNgn((maxToken * tokenRate).toFixed(2));
            }}
            activeOpacity={0.8}
          >
            <Text style={[s.chipText, { color: colors.primary }]}>Max</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[s.source, { backgroundColor: colors.card }]}
          onPress={() => setShowTokenSheet(true)}
          activeOpacity={0.8}
        >
          {selectedToken ? (
            <View>
              <TokenLogo symbol={selectedToken} size={36} dark />
              {selectedNetwork && CHAIN_LOGOS[selectedNetwork.tag] && (
                <Image
                  source={CHAIN_LOGOS[selectedNetwork.tag]}
                  style={[s.sourceBadge, { borderColor: colors.card }]}
                />
              )}
            </View>
          ) : (
            <View style={[s.sourceEmpty, { backgroundColor: colors.muted }]}>
              <Feather name="plus" size={17} color={colors.mutedForeground} />
            </View>
          )}

          <View style={{ flex: 1 }}>
            <Text style={[s.sourceLabel, { color: colors.mutedForeground }]}>
              {selectedToken && selectedNetwork
                ? `${assetLabel(selectedToken)} on ${selectedNetwork.name}`
                : "Choose what to send"}
            </Text>
            <Text style={[s.sourceValue, { color: colors.foreground }]}>
              {selectedToken && selectedNetwork
                ? `₦${ceiling.toLocaleString()}`
                : "No asset selected"}
            </Text>
          </View>

          <Text style={[s.sourceChange, { color: colors.primary }]}>Change</Text>
        </TouchableOpacity>

        {!!stellarNote && (
          <Text style={[s.stellarNote, { color: colors.mutedForeground }]}>{stellarNote}</Text>
        )}

        <Keypad
          decimal
          disabled={!selectedToken || !selectedNetwork}
          style={s.pad}
          onKey={handleAmountKey}
          onBackspace={() => handleAmountInput(display.slice(0, -1))}
        />

        {/* Under the keypad, where a commit belongs. Above it, Continue sat
            between the figure and the keys used to reach it. */}
        <TouchableOpacity
          style={[
            ts.primaryBtn,
            {
              backgroundColor: colors.primary,
              opacity: canProceed ? 1 : 0.4,
              marginTop: 12,
              marginBottom: bottomPad + 10,
            },
          ]}
          onPress={handleProceed}
          disabled={!canProceed}
          activeOpacity={0.85}
        >
          <Text style={[ts.primaryBtnText, { color: colors.primaryForeground }]}>Continue</Text>
        </TouchableOpacity>
      </View>

      {/* Asset picker — one row per holding, the same sheet the bank
          transfer uses. */}
      {showTokenSheet && (
        <Modal transparent animationType="slide" visible>
          <TouchableOpacity
            style={ts.modalOverlay}
            activeOpacity={1}
            onPress={() => { setShowTokenSheet(false); setAssetSearch(""); }}
          >
            <View
              style={[ts.bankSheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 20 }]}
              onStartShouldSetResponder={() => true}
            >
              <View style={s.pickerHeader}>
                <TouchableOpacity onPress={() => { setShowTokenSheet(false); setAssetSearch(""); }}>
                  <Feather name="chevron-down" size={24} color={colors.foreground} />
                </TouchableOpacity>
                <Text style={[s.pickerTitle, { color: colors.foreground }]}>Select asset</Text>
                <View style={{ width: 24 }} />
              </View>

              <View style={[s.pickerSearch, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Feather name="search" size={18} color={colors.mutedForeground} />
                <TextInput
                  style={[s.pickerSearchInput, { color: colors.foreground }]}
                  placeholder="Search"
                  placeholderTextColor={colors.mutedForeground}
                  value={assetSearch}
                  onChangeText={setAssetSearch}
                  autoCorrect={false}
                />
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {filteredOptions.length === 0 && (
                  <Text style={[s.pickerEmpty, { color: colors.mutedForeground }]}>
                    {assetSearch.trim()
                      ? `Nothing matches "${assetSearch.trim()}".`
                      : "No balance to send yet."}
                  </Text>
                )}

                {pickerOptions.map((opt) => {
                  const active =
                    selectedToken === opt.token && selectedNetwork?.tag === opt.chain.tag;
                  const blocked = stellarBlocked(opt.token, opt.chain.tag);
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[s.assetRow, { borderBottomColor: colors.border, opacity: blocked ? 0.45 : 1 }]}
                      disabled={blocked}
                      onPress={() => {
                        // Both halves of the choice, from the one tap.
                        setSelectedToken(opt.token);
                        setSelectedNetwork(opt.chain);
                        setNgnAmount("");
                        setDisplay("");
                        setStellarNote("");
                        setShowTokenSheet(false);
                        setAssetSearch("");
                      }}
                      activeOpacity={0.75}
                    >
                      <View>
                        <TokenLogo symbol={opt.token} size={40} dark />
                        {CHAIN_LOGOS[opt.chain.tag] && (
                          <Image
                            source={CHAIN_LOGOS[opt.chain.tag]}
                            style={[s.assetChainBadge, { borderColor: colors.card }]}
                          />
                        )}
                      </View>

                      <View style={{ flex: 1 }}>
                        <View style={s.assetNameRow}>
                          <Text style={[s.assetName, { color: colors.foreground }]}>
                            {assetLabel(opt.token)}
                          </Text>
                          {active && (
                            <Feather name="check" size={15} color={colors.primary} style={{ marginLeft: 5 }} />
                          )}
                        </View>
                        <Text style={[s.assetChain, { color: colors.mutedForeground }]} numberOfLines={1}>
                          {blocked ? `${opt.chain.name} · @${recipientUsername} can't receive this yet` : opt.chain.name}
                        </Text>
                      </View>

                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={[s.assetValue, { color: colors.foreground }]}>
                          ₦{Math.floor(opt.ngn).toLocaleString()}
                        </Text>
                        <Text style={[s.assetSub, { color: colors.mutedForeground }]}>
                          {opt.balance.toFixed(tokenDecimals(opt.token))} {assetLabel(opt.token)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

    </View>
  );
}

const s = StyleSheet.create({
  source: { marginHorizontal: 16, marginTop: 12, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18 },

  // Centred as a column: the recipient chip, the figure and the unit share a
  // centre line, and each hugs its own width so none of them spans the screen.
  amountWrap: { alignItems: "center", paddingTop: 26, paddingHorizontal: 20 },

  toChip: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 5, paddingRight: 13, paddingVertical: 5, borderRadius: 999, maxWidth: "100%" },
  toAvatar: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  toAvatarText: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_800ExtraBold" },
  toName: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold", flexShrink: 1 },

  amountRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", marginTop: 20 },

  swap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 16,
  },
  swapValue: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  swapDot: { fontSize: 12.5, lineHeight: 17 },
  swapTo: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_700Bold" },

  chips: { flexDirection: "row", gap: 6, paddingHorizontal: 16 },
  // Four across, so the row gives up padding and type size to fit the widest
  // figure without truncating it.
  chip: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 12 },
  chipText: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  amountSymbol: { fontSize: 24, lineHeight: 34, fontFamily: "Inter_700Bold", marginTop: 5 },
  // Scaled to the 40pt figure beside it, on the same optical baseline.
  // Box, not glyph: `contain` scales the mark's transparent margin too, so
  // it fills about two thirds of what is set here. 43 lands it on the cap
  // height of the 40pt figure; the lift puts it on their baseline.
  nairaGlyph: { width: 43 * FONT_SCALE, height: 43 * FONT_SCALE, resizeMode: "contain", marginRight: -5 * FONT_SCALE, marginBottom: 4 * FONT_SCALE },
  amountValue: { fontSize: 40, lineHeight: 48, fontFamily: "Inter_800ExtraBold", letterSpacing: -1.4 },


  amountErr: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_500Medium", marginTop: 10, textAlign: "center" },

  // Button above the pad, both pinned: the form scrolls, the controls do not.
  dock: { paddingTop: 4 },
  // The keys are flex:1, so the pad has to bound itself out here.
  pad: { marginTop: 14 },
  sourceBadge: { position: "absolute", right: -2, bottom: -2, width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  sourceEmpty: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  sourceLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular" },
  sourceValue: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_700Bold", marginTop: 2 },
  sourceChange: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  stellarNote: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginHorizontal: 20, marginTop: 8 },

  pickerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  pickerTitle: { fontSize: 17, lineHeight: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  pickerSearch: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 14,
    paddingHorizontal: 14, height: 46, marginBottom: 6,
  },
  pickerSearchInput: { flex: 1, fontSize: 14.5, fontFamily: "Inter_500Medium" },
  pickerEmpty: {
    fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular",
    textAlign: "center", paddingVertical: 34, paddingHorizontal: 24,
  },

  assetRow: { flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  // Sits on the coin, ringed in the sheet's own colour so it reads as attached
  // rather than as a second, smaller coin.
  assetChainBadge: { position: "absolute", right: -2, bottom: -2, width: 17, height: 17, borderRadius: 9, borderWidth: 2 },
  assetNameRow: { flexDirection: "row", alignItems: "center" },
  assetName: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  assetChain: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 1 },
  assetValue: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_700Bold" },
  assetSub: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 1 },


  /* Token/network pills + big amount hero (mirrors the sell screen) */
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 24, borderWidth: 1, height: 44 },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 10 },
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  tokenSheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderBottomWidth: 1,
  },
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  tokenName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  tokenBal: { fontSize: 13, fontFamily: "Inter_400Regular", marginRight: 6 },
  netOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
  },
  netName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  netBal: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  netLogo: { width: 32, height: 32, borderRadius: 16 },
});
