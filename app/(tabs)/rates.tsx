import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { TokenLogo } from "@/components/TokenLogo";
import { getRates, type RatesResponse, type TokenRate } from "@/services/rates";

type Tab = "sell" | "buy";
type Symbol = "USDC" | "USDT" | "MOVE" | "SOL";

const TOKEN_META: Record<Symbol, { name: string; color: string }> = {
  USDC: { name: "USD Coin", color: "#2775CA" },
  USDT: { name: "Tether", color: "#26A17B" },
  MOVE: { name: "Movement", color: "#81FB02" },
  SOL: { name: "Solana", color: "#9945FF" },
};

// SOL is not fundable or sellable here. Quoting a rate for it offers a
// trade that cannot be taken.
const SYMBOLS: Symbol[] = ["USDC", "USDT", "MOVE"];

export default function RatesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [tab, setTab] = useState<Tab>("sell");
  const [timer, setTimer] = useState(600);
  const [rates, setRates] = useState<RatesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadRates = useCallback(async () => {
    try {
      const data = await getRates();
      setRates(data);
      setTimer(600);
    } catch (err) {
      console.error("[RATES SCREEN] Failed to fetch rates:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRates(); }, [loadRates]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimer((t) => {
        if (t <= 1) { loadRates(); return 600; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [loadRates]);

  const formatTimer = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")} : ${String(sec).padStart(2, "0")}`;
  };

  const getRate = (sym: Symbol): any =>
    rates?.[sym] ?? { usd: 0, ngn: 0, fundNgn: 0, change24h: 0 };

  const fmtRate = (ngn: number, sym: string) => {
    const prefix = (sym === "USDC" || sym === "USDT") ? "$1" : `1 ${sym}`;
    return `${prefix} = ₦${ngn < 1 ? ngn.toFixed(4) : Math.round(ngn).toLocaleString()}`;
  };

  const renderTokenList = (useFundRate: boolean) => (
    <ScrollView
      contentContainerStyle={styles.ratesContent}
      showsVerticalScrollIndicator={false}
    >
      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <>
          {SYMBOLS.map((sym) => {
            const r = getRate(sym);
            const meta = TOKEN_META[sym];
            const ngn = useFundRate ? (r.fundNgn || Math.round(r.ngn * 1.02)) : r.ngn;
            return (
              <View key={sym} style={[styles.rateCard, { backgroundColor: colors.card }]}>
                <TokenLogo symbol={sym} size={44} />
                <View style={styles.rateInfo}>
                  <Text style={[styles.rateSymbol, { color: colors.foreground }]}>{sym}</Text>
                  <Text style={[styles.rateName, { color: colors.mutedForeground }]}>{meta.name}</Text>
                </View>
                <View style={styles.rateRight}>
                  <Text style={[styles.rateNgn, { color: colors.foreground }]}>
                    {fmtRate(ngn, sym)}
                  </Text>
                  <Text
                    style={[styles.rateChange, { color: r.change24h >= 0 ? colors.success : colors.destructive }]}
                  >
                    {r.change24h >= 0 ? "+" : ""}{r.change24h.toFixed(2)}%
                  </Text>
                </View>
              </View>
            );
          })}

          <View style={[styles.infoCard, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "33" }]}>
            <Feather name="info" size={16} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              Exchange rates refresh every 10 minutes. Actual conversion rates may vary slightly at time of trade.
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Tab Bar */}
      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        {(["sell", "buy"] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[
              styles.tabItem,
              t === tab && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
            ]}
            onPress={() => setTab(t)}
          >
            <Text
              style={[
                styles.tabText,
                {
                  color: t === tab ? colors.foreground : colors.mutedForeground,
                  fontFamily: t === tab ? "Inter_600SemiBold" : "Inter_400Regular",
                },
              ]}
            >
              {t === "sell" ? "Sell Rates" : "Fund Rates"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Timer Banner */}
      <View style={[styles.timerBanner, { backgroundColor: colors.muted }]}>
        <Text style={[styles.timerLabel, { color: colors.mutedForeground }]}>
          Rate refreshes in
        </Text>
        <Text style={[styles.timer, { color: colors.foreground }]}>
          {formatTimer(timer)}
        </Text>
      </View>

      {tab === "sell" ? renderTokenList(false) : renderTokenList(true)}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  tabBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 16,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabText: { fontSize: 15 },

  timerBanner: {
    alignItems: "center",
    paddingVertical: 14,
    gap: 4,
  },
  timerLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  timer: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: 2 },

  ratesContent: { padding: 20, gap: 10, paddingBottom: 40 },

  rateCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 14,
    gap: 12,
  },
  rateInfo: { flex: 1 },
  rateSymbol: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rateName: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  rateRight: { alignItems: "flex-end", gap: 3 },
  rateNgn: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rateChange: { fontSize: 12, fontFamily: "Inter_500Medium" },

  infoCard: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "flex-start",
    marginTop: 8,
  },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
