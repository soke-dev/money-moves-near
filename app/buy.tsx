import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  Modal,
  FlatList,
  Animated,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Alert,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { TokenLogo } from "@/components/TokenLogo";
import { TransactionItem } from "@/components/TransactionItem";
import { TOKEN_NETWORKS } from "@/constants/transfer";
import { getFundingLimits, FundingLimits } from "@/services/funding";
import { getTransactions } from "@/services/transactions";
import { KeyboardDoneBar } from "@/components/KeyboardDoneBar";



type Asset = "USDC" | "USDT" | "USDCx" | "ETH" | "MOVE" | "SOL";

const CHAIN_LOGOS: Record<string, any> = {
  MOVE: require("@/assets/images/movementnew.jpg"),
  BASE: require("@/assets/images/base logo.png"),
  SOL: require("@/assets/images/solana.png"),
  BEP20: require("@/assets/images/bsc logo.png"),
  ARC: require("@/assets/images/ARC.jpg"),
  ARB: require("@/assets/images/arbitrumlogo.png"),
};
const FEE_RATE = 0.01;

interface AssetInfo {
  symbol: Asset;
  name: string;
  chainLogos: any[];
}

const ASSETS: AssetInfo[] = [
  { symbol: "USDC", name: "USD Coin", chainLogos: [require("@/assets/images/movementnew.jpg"), require("@/assets/images/base logo.png"), require("@/assets/images/solana.png")] },
  { symbol: "USDT", name: "USDT", chainLogos: [require("@/assets/images/movementnew.jpg"), require("@/assets/images/solana.png")] },
  { symbol: "MOVE", name: "MOVE", chainLogos: [require("@/assets/images/movementnew.jpg")] },
];

export default function FundScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, walletReady, rates, refreshRates } = useApp();

  useEffect(() => {
    // Load live rates on mount if not yet loaded
    if (!rates) refreshRates();
  }, [rates, refreshRates]);

  useEffect(() => {
    if (!walletReady) {
      Alert.alert("Wallet Required", "Create your wallet first to buy crypto.", [{ text: "OK", onPress: () => router.back() }]);
    }
  }, [walletReady]);

  const [recentBuys, setRecentBuys] = useState<any[]>([]);
  useEffect(() => {
    getTransactions({ type: "BUY", limit: 5 })
      .then((r) => setRecentBuys(r.transactions))
      .catch(() => {});
  }, []);
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const verified = !!user?.verified;

  const [ngnAmount, setNgnAmount] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<Asset>("USDC");
  const [amountError, setAmountError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [showChainPicker, setShowChainPicker] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");
  const [selectedChain, setSelectedChain] = useState<typeof TOKEN_NETWORKS.USDC[0] | null>(null);
  const [converting, setConverting] = useState(false);
  const DEFAULT_LIMITS: FundingLimits = { allowed: true, perTx: 20000, dailyLimit: 200000, spentToday: 0, remaining: 200000 };
  const [fundLimits, setFundLimits] = useState<FundingLimits>(DEFAULT_LIMITS);
  const inputRef = useRef<TextInput>(null);
  const convertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch funding limits on mount
  useEffect(() => {
    if (verified) {
      getFundingLimits().then(setFundLimits).catch(() => setFundLimits(DEFAULT_LIMITS));
    }
  }, [verified]);

  // Use fund rate (base + 2%) from API. Fallback to 0 (shows 0 crypto until loaded).
  const liveNgnRate = (rates?.[selectedAsset] as any)?.fundNgn || rates?.[selectedAsset]?.ngn || 0;
  const ngn = Number(ngnAmount.replace(/,/g, "")) || 0;
  const feeNgn = ngn * FEE_RATE;
  const cryptoAmount = liveNgnRate > 0 ? (ngn - feeNgn) / liveNgnRate : 0;
  const usd = rates?.USDC?.ngn ? ngn / rates.USDC.ngn : 0;
  const feeUsd = usd * FEE_RATE;

  const selectedInfo = ASSETS.find((a) => a.symbol === selectedAsset)!;
  // Hide BEP20 from funding; BASE hidden except for USDC
  const chains = TOKEN_NETWORKS[selectedAsset].filter((n) => {
    if (n.tag === "BEP20") return false;
    // Not TON. Buying is an on-ramp and that lands on Movement; there is no
    // treasury sending USDT on TON, so offering it here would take the naira
    // and leave the delivery pending. Stellar and Monad are off-ramp only,
    // the same way.
    if (n.tag === "TON" || n.tag === "STELLAR" || n.tag === "MONAD") return false;
    if (n.tag === "BASE" && selectedAsset !== "USDC") return false;
    return true;
  });
  const hasMultipleChains = chains.length > 1;

  const filteredAssets = assetSearch.trim()
    ? ASSETS.filter(
        (a) =>
          a.name.toLowerCase().includes(assetSearch.toLowerCase()) ||
          a.symbol.toLowerCase().includes(assetSearch.toLowerCase()),
      )
    : ASSETS;

  /* Show converting spinner briefly when amount changes */
  useEffect(() => {
    if (ngn > 0) {
      setConverting(true);
      if (convertTimer.current) clearTimeout(convertTimer.current);
      convertTimer.current = setTimeout(() => setConverting(false), 400);
    } else {
      setConverting(false);
    }
  }, [ngnAmount]);

  const formatDisplay = (raw: string) => {
    const num = raw.replace(/[^0-9]/g, "");
    if (!num) return "";
    return Number(num).toLocaleString("en-NG");
  };

  const handleAmountChange = (text: string) => {
    const digits = text.replace(/[^0-9]/g, "");
    const val = digits ? Number(digits) : 0;
    setNgnAmount(digits ? val.toLocaleString("en-NG") : "");

    // Real-time limit validation
    if (verified && val > 0) {
      if (val > fundLimits.perTx) {
        setAmountError(`Max ₦${fundLimits.perTx.toLocaleString()} per transaction`);
        return;
      }
      if (val > fundLimits.remaining) {
        setAmountError(
          fundLimits.remaining <= 0
            ? `Daily limit of ₦${fundLimits.dailyLimit.toLocaleString()} reached`
            : `Only ₦${Math.floor(fundLimits.remaining).toLocaleString()} remaining today`
        );
        return;
      }
    }
    if (amountError) setAmountError("");
  };

  const handleFund = () => {
    if (!ngn || ngn <= 0) {
      setAmountError("Please enter a valid amount in Naira");
      return;
    }
    if (verified) {
      if (ngn > fundLimits.perTx) {
        setAmountError(`Max ₦${fundLimits.perTx.toLocaleString()} per transaction`);
        return;
      }
      if (ngn > fundLimits.remaining) {
        setAmountError(
          fundLimits.remaining <= 0
            ? `Daily limit of ₦${fundLimits.dailyLimit.toLocaleString()} reached. Try again tomorrow.`
            : `Exceeds daily limit. ₦${Math.floor(fundLimits.remaining).toLocaleString()} remaining today.`
        );
        return;
      }
    }
    // Final guard — never proceed with an active error
    if (amountError) return;
    router.push({
      pathname: "/buy-summary",
      params: {
        asset: selectedAsset,
        network: selectedChain!.name,
        chain: selectedChain!.tag,
        ngnAmount: String(ngn),
        cryptoAmount: String(cryptoAmount),
        usdValue: String(usd),
        fee: String(feeNgn),
        assetName: selectedInfo.name,
        liveRate: String(liveNgnRate),
      },
    } as any);
  };

  const buttonLabel = loading
    ? "Processing..."
    : !selectedChain
    ? "Select Network"
    : `Continue with ${selectedInfo.name}`;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Image source={require("@/assets/images/logo-badge.png")} style={styles.headerLogo} />
        <View style={{ width: 24 }} />
      </View>

      {/* KYC Gate */}
      {!verified ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Feather name="lock" size={56} color={colors.mutedForeground} />
          <Text style={{ fontSize: 20, fontFamily: "Inter_700Bold", color: colors.foreground, marginTop: 20, textAlign: "center" }}>
            Verification Required
          </Text>
          <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 10, textAlign: "center", lineHeight: 22 }}>
            Complete KYC verification to buy and fund crypto on Money Moves.
          </Text>
          <TouchableOpacity
            style={{ backgroundColor: colors.foreground, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, marginTop: 24 }}
            onPress={() => router.push("/account/kyc")}
          >
            <Text style={{ color: colors.background, fontSize: 15, fontFamily: "Inter_600SemiBold" }}>Complete KYC</Text>
          </TouchableOpacity>
        </View>
      ) : (
      <>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={topPad}
      >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 20 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Selector Pills */}
        <View style={styles.pillRow}>
          <TouchableOpacity
            style={[styles.pill, styles.assetPill, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowAssetPicker(true)}
          >
            <TokenLogo symbol={selectedAsset} size={22} />
            <Text style={[styles.pillText, { color: colors.foreground }]}>Buy {selectedAsset}</Text>
            <Feather name="chevron-down" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pill, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => setShowChainPicker(true)}
          >
            {selectedChain ? (
              <Image source={CHAIN_LOGOS[selectedChain.tag]} style={[styles.chainPillLogo, selectedChain.tag === "ARB" && { transform: [{ scale: 1.2 }] }]} />
            ) : null}
            <Text style={[styles.pillText, { color: selectedChain ? colors.foreground : colors.mutedForeground }]}>
              {selectedChain ? selectedChain.name : "Select Network"}
            </Text>
            <Feather name="chevron-down" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Big Amount */}
        <View style={styles.bigAmountWrap}>
          <View style={styles.bigAmountRow}>
            <Text style={[styles.bigNaira, { color: colors.mutedForeground, ...(Platform.OS === "web" ? { fontFamily: "system-ui, -apple-system, sans-serif" } : {}) }]}>₦</Text>
            <TextInput
              ref={inputRef}
              style={[styles.bigAmountInput, { color: colors.foreground }]}
              value={ngnAmount}
              onChangeText={handleAmountChange}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.mutedForeground}
              textAlign="center"
            />
          </View>
          <View style={styles.cryptoEquivRow}>
            <Feather name="repeat" size={14} color={colors.mutedForeground} />
            {converting ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} style={{ marginLeft: 6 }} />
            ) : (
              <Text style={[styles.cryptoEquivText, { color: colors.mutedForeground }]}>
                {ngn > 0 ? `${cryptoAmount.toFixed(selectedAsset === "ETH" ? 8 : 4)} ${selectedAsset}` : `0 ${selectedAsset}`}
              </Text>
            )}
            {converting && <ActivityIndicator size="small" color={colors.mutedForeground} style={{ marginLeft: 4 }} />}
          </View>
          {amountError ? <Text style={{ color: "#ef4444", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 6, textAlign: "center" }}>{amountError}</Text> : null}
          {liveNgnRate > 0 && (
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 6, textAlign: "center" }}>
              1 {selectedAsset} ≈ ₦{liveNgnRate.toLocaleString()}
            </Text>
          )}
        </View>

        {/* Continue Button */}
        <TouchableOpacity
          style={[styles.fundBtn, { backgroundColor: colors.primary, opacity: loading || !ngn || !selectedChain || !!amountError ? 0.7 : 1 }]}
          onPress={handleFund}
          disabled={loading || !ngn || !selectedChain || !!amountError}
        >
          <Text style={[styles.fundBtnText, { color: colors.primaryForeground }]}>
            {buttonLabel}
          </Text>
        </TouchableOpacity>

        {/* Recent Buy Transactions */}
        {recentBuys.length > 0 && (
          <View style={styles.recentSection}>
            <Text style={[styles.recentTitle, { color: colors.foreground }]}>Recent</Text>
            {recentBuys.map((tx) => (
              <TouchableOpacity
                key={tx.id}
                onPress={() => router.push({ pathname: "/transactions/receipt", params: { id: tx.id } })}
                activeOpacity={0.7}
              >
                <TransactionItem
                  type={tx.type}
                  asset={tx.asset}
                  amount={Number(tx.amount)}
                  createdAt={tx.createdAt}
                  status={tx.status}
                  metadata={tx.metadata}
                />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Asset Picker Modal */}
      {showAssetPicker && (
        <Modal transparent animationType="slide" visible>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
          <Pressable style={[styles.modalOverlay]} onPress={() => { setShowAssetPicker(false); setAssetSearch(""); }}>
            <Pressable style={[styles.pickerSheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 20 }]} onPress={(e) => e.stopPropagation()}>
              {/* Picker header */}
              <View style={styles.pickerHeader}>
                <TouchableOpacity onPress={() => { setShowAssetPicker(false); setAssetSearch(""); }}>
                  <Feather name="chevron-down" size={24} color={colors.foreground} />
                </TouchableOpacity>
                <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Select asset</Text>
                <View style={{ width: 24 }} />
              </View>

              {/* Search */}
              <View style={[styles.pickerSearch, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Feather name="search" size={18} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.pickerSearchInput, { color: colors.foreground }]}
                  placeholder="Search"
                  placeholderTextColor={colors.mutedForeground}
                  value={assetSearch}
                  onChangeText={setAssetSearch}
                />
              </View>

              {/* Asset list */}
              <FlatList
                data={filteredAssets}
                keyExtractor={(item) => item.symbol}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.assetListRow, { borderBottomColor: colors.border }]}
                    onPress={() => {
                      setSelectedAsset(item.symbol);
                      const nets = TOKEN_NETWORKS[item.symbol].filter((n) => {
                        if (n.tag === "BEP20") return false;
                        // Not TON. Buying is an on-ramp and that lands on
                        // Movement; there is no treasury sending USDT on TON.
                        // Stellar and Monad are off-ramp only, the same way.
                        if (n.tag === "TON" || n.tag === "STELLAR" || n.tag === "MONAD") return false;
                        if (n.tag === "BASE" && item.symbol !== "USDC") return false;
                        return true;
                      });
                      setSelectedChain(nets.length === 1 ? nets[0] : null);
                      setShowAssetPicker(false);
                      setAssetSearch("");
                    }}
                  >
                    <TokenLogo symbol={item.symbol} size={40} />
                    <View style={styles.assetListInfo}>
                      <View style={styles.assetNameRow}>
                        <Text style={[styles.assetListName, { color: colors.foreground }]}>{item.name}</Text>
                        <Feather name="check-circle" size={14} color={colors.primary} style={{ marginLeft: 4 }} />
                      </View>
                      <View style={styles.assetChainRow}>
                        {item.chainLogos.map((logo: any, i: number) => (
                          <Image
                            key={i}
                            source={logo}
                            style={[styles.assetChainLogo, i === 0 ? { marginLeft: 0 } : null, logo === CHAIN_LOGOS.ARB && { borderRadius: 0, borderWidth: 0, transform: [{ scale: 1.2 }] }]}
                          />
                        ))}
                        <Text style={[styles.assetListChain, { color: colors.mutedForeground }]}>
                          {item.chainLogos.length} {item.chainLogos.length === 1 ? "chain" : "chains"}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.assetListRight}>
                      <View style={styles.assetPriceCol}>
                        <Text style={[styles.assetListPrice, { color: colors.foreground }]}>
                          ₦{rates?.[item.symbol]?.ngn?.toLocaleString() || "—"}
                        </Text>
                        <Text style={[styles.assetListChange, { color: (rates?.[item.symbol]?.change24h ?? 0) >= 0 ? "#10b981" : "#ef4444" }]}>
                          {(rates?.[item.symbol]?.change24h ?? 0) >= 0 ? "▲" : "▼"} {Math.abs(rates?.[item.symbol]?.change24h ?? 0).toFixed(2)}%
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                )}
              />
            </Pressable>
          </Pressable>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* Chain Picker Modal */}
      {showChainPicker && (
        <Modal transparent animationType="slide" visible>
          <Pressable style={styles.modalOverlay} onPress={() => setShowChainPicker(false)}>
            <Pressable style={[styles.pickerSheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 20 }]} onPress={(e) => e.stopPropagation()}>
              <View style={styles.pickerHeader}>
                <TouchableOpacity onPress={() => setShowChainPicker(false)}>
                  <Feather name="chevron-down" size={24} color={colors.foreground} />
                </TouchableOpacity>
                <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Select network</Text>
                <View style={{ width: 24 }} />
              </View>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, paddingHorizontal: 20, marginBottom: 12, textAlign: "center" }}>
                Choose the network your tokens will be sent to
              </Text>
              {chains.map((chain) => (
                <TouchableOpacity
                  key={chain.tag}
                  style={[styles.chainPickRow, { borderBottomColor: colors.border }]}
                  onPress={() => { setSelectedChain(chain); setShowChainPicker(false); }}
                >
                  <Image source={CHAIN_LOGOS[chain.tag]} style={[styles.chainPickLogo, chain.tag === "ARB" && { transform: [{ scale: 1.2 }] }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.chainPickName, { color: colors.foreground }]}>{chain.name}</Text>
                  </View>
                  {selectedChain?.tag === chain.tag && (
                    <Feather name="check" size={20} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
    )}

      <KeyboardDoneBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerLogo: { width: 32, height: 32, borderRadius: 16 },
  content: { paddingHorizontal: 20 },

  /* Selector pills */
  pillRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, marginBottom: 32, flexWrap: "wrap", justifyContent: "center" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    height: 44,
  },
  assetPill: { gap: 8 },
  pillText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  chainPillLogo: { width: 20, height: 20, borderRadius: 10 },

  /* Big amount */
  bigAmountWrap: { alignItems: "center", marginBottom: 40 },
  bigAmountRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  bigNaira: { fontSize: 32, fontFamily: "Inter_700Bold", marginRight: 2 },
  bigAmountInput: { fontSize: 56, fontFamily: "Inter_700Bold", minWidth: 60, textAlign: "center" },
  cryptoEquivRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  cryptoEquivText: { fontSize: 14, fontFamily: "Inter_400Regular", marginLeft: 6 },

  /* Fund button */
  fundBtn: {
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  fundBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },

  /* Recent transactions */
  recentSection: { marginTop: 24 },
  recentTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 12 },

  /* Modal */
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "80%" },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  pickerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  pickerSearch: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 44,
    gap: 10,
    marginBottom: 16,
  },
  pickerSearchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  pickerSectionLabel: { fontSize: 15, fontFamily: "Inter_700Bold", paddingHorizontal: 20, marginBottom: 8 },

  /* Asset list */
  assetListRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  assetListInfo: { flex: 1 },
  assetNameRow: { flexDirection: "row", alignItems: "center" },
  assetListName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  assetChainRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  assetChainLogo: { width: 16, height: 16, borderRadius: 8, marginLeft: -4, borderWidth: 1.5, borderColor: "#1a1a1a" },
  assetListChain: { fontSize: 12, fontFamily: "Inter_400Regular", marginLeft: 4 },
  assetListRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  assetPriceCol: { alignItems: "flex-end" },
  assetListPrice: { fontSize: 14, fontFamily: "Inter_700Bold" },
  assetListChange: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },

  /* Chain picker */
  chainPickRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chainPickLogo: { width: 36, height: 36, borderRadius: 18 },
  chainPickName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  chainPickTag: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
