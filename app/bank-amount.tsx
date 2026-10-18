import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, TextInput, Platform, Modal, KeyboardAvoidingView, Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { ts, QUICK_AMOUNTS, BANK_FEE_RATE, fmtNaira } from "@/constants/transfer";
import { useApp } from "@/context/AppContext";
import { CurrencyToggle, AmountCurrency } from "@/components/CurrencyToggle";
import { getSellLimits } from "@/services/transactions";

export default function BankAmountScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ngnBalance, user, walletReady, rates } = useApp();

  useEffect(() => {
    if (!walletReady) {
      Alert.alert("Wallet Required", "Create your wallet first to transfer to bank.", [{ text: "OK", onPress: () => router.back() }]);
    }
  }, [walletReady]);
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const verified = !!user?.verified;

  // Transfer to Bank limits
  /**
   * The server's own numbers, including what today has already used.
   *
   * The tier constants were right but static: they could not know that ₦18,000
   * of a ₦20,000 day was already gone, so someone typed ₦5,000, walked to the
   * summary, confirmed, and got the refusal there. These come from
   * /sell/limits and are checked on every keystroke.
   */
  const DAILY_LIMIT = verified ? 2000000 : 20000;
  const PER_TX_LIMIT = verified ? 500000 : 10000;

  const [limits, setLimits] = useState<{ perTx: number; remaining: number; dailyLimit: number } | null>(null);

  useEffect(() => {
    let alive = true;
    getSellLimits()
      .then((l) => alive && setLimits({ perTx: l.perTx, remaining: l.remaining, dailyLimit: l.dailyLimit }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const perTx = limits?.perTx ?? PER_TX_LIMIT;
  const dailyCap = limits?.dailyLimit ?? DAILY_LIMIT;
  // Until the call lands, assume a full day rather than block the screen.
  const leftToday = limits?.remaining ?? dailyCap;

  const params = useLocalSearchParams<{ bank: string; accountNumber: string; accountName: string }>();
  const { bank, accountNumber, accountName } = params;

  const [amount, setAmount] = useState("");   // canonical NGN integer string
  const [display, setDisplay] = useState(""); // text shown in the input (NGN or USD)
  const [currency, setCurrency] = useState<AmountCurrency>("NGN");
  const [narration, setNarration] = useState("");
  const [amountError, setAmountError] = useState("");

  // NGN per 1 USD (USDC ≈ $1). 0 when rates aren't loaded yet.
  const usdNgn = rates?.USDC?.ngn || 0;
  const usdEquivalent = usdNgn > 0 && Number(amount) > 0 ? Number(amount) / usdNgn : 0;

  // Set the canonical NGN amount and keep the input text in sync with the
  // currently selected currency (used by MAX and the quick-amount chips).
  const setNgn = (ngn: string) => {
    setAmount(ngn);
    setDisplay(currency === "USD" && usdNgn > 0 && ngn ? (Number(ngn) / usdNgn).toFixed(2) : ngn);
  };

  const handleAmountInput = (t: string) => {
    if (amountError) setAmountError("");
    if (currency === "NGN") {
      const digits = t.replace(/[^0-9]/g, "");
      setDisplay(digits);
      setAmount(digits);
    } else {
      // allow a single decimal point for USD entry
      const clean = t.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
      setDisplay(clean);
      setAmount(usdNgn > 0 && clean ? String(Math.round(Number(clean) * usdNgn)) : "");
    }
  };

  const handleCurrencyChange = (next: AmountCurrency) => {
    if (next === currency || usdNgn <= 0) return;
    setCurrency(next);
    if (!amount) { setDisplay(""); return; }
    setDisplay(next === "USD" ? (Number(amount) / usdNgn).toFixed(2) : amount);
  };

  const bankFee = Math.round(Number(amount) * BANK_FEE_RATE);
  const bankTotal = Number(amount) + bankFee;
  const bankMaxAmount = Math.floor(ngnBalance / (1 + BANK_FEE_RATE));
  const insufficientBank = Number(amount) > 0 && bankTotal > ngnBalance;

  /**
   * Said while they type, so the amount can be corrected in place. The daily
   * figure is checked first: when nothing is left, the per-transfer cap is
   * beside the point.
   */
  const limitError = (() => {
    const num = Number(amount);
    if (!num || num <= 0) return "";
    if (leftToday <= 0) {
      return `You have used your ${fmtNaira(dailyCap)} for today. Try again tomorrow.`;
    }
    if (num > leftToday && leftToday < dailyCap) {
      return `${fmtNaira(leftToday)} left of today's ${fmtNaira(dailyCap)}.`;
    }
    if (num > perTx) {
      return verified
        ? `Most you can send at once is ${fmtNaira(perTx)}.`
        : `Most you can send at once is ${fmtNaira(perTx)}. Verify your ID to raise it.`;
    }
    if (num > leftToday) {
      return `${fmtNaira(leftToday)} left of today's ${fmtNaira(dailyCap)}.`;
    }
    return "";
  })();

  const overLimit = !!limitError;

  const handleProceed = () => {
    const num = Number(amount);
    if (!num || num <= 0) {
      setAmountError("Please enter an amount");
      return;
    }
    if (limitError) {
      setAmountError(limitError);
      return;
    }
    if (insufficientBank) return;
    router.push({
      pathname: "/bank-summary",
      params: { bank, accountNumber, accountName, amount, narration },
    } as any);
  };

  return (
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={ts.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[ts.headerTitle, { color: colors.foreground }]}>Bank Transfer</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: bottomPad + 90 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={{ paddingHorizontal: 20, marginTop: 8 }}>
          <View style={[ts.recipientCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[ts.bankDot, { backgroundColor: "#ef4444" }]} />
            <View>
              <Text style={[ts.recipientBank, { color: colors.foreground }]}>{bank}</Text>
              <Text style={[ts.recipientName, { color: colors.mutedForeground }]}>{accountName}</Text>
            </View>
          </View>
        </View>
        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
          <View style={ts.amountLabelRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={[ts.amountLabel, { color: colors.foreground }]}>Amount</Text>
              <CurrencyToggle value={currency} onChange={handleCurrencyChange} disabled={usdNgn <= 0} />
            </View>
            <TouchableOpacity onPress={() => setNgn(String(bankMaxAmount))}>
              <Text style={[ts.maxBtn, { color: colors.primary }]}>MAX</Text>
            </TouchableOpacity>
          </View>
          <Text style={[ts.balanceLabel, { color: colors.mutedForeground, marginBottom: 8 }]}>Current Balance: {fmtNaira(ngnBalance)}</Text>
          <View style={[ts.amountInputWrap, { borderColor: insufficientBank ? "#ef4444" : colors.border, backgroundColor: colors.card }]}>
            <Text style={[ts.nairaPrefix, { color: colors.foreground }]}>{currency === "USD" ? "$" : "₦"}</Text>
            <TextInput
              style={[ts.amountInput, { color: colors.foreground }]}
              placeholder={currency === "USD" ? "0.00" : "0"}
              placeholderTextColor={colors.mutedForeground}
              value={display}
              onChangeText={handleAmountInput}
              keyboardType={currency === "USD" ? "decimal-pad" : "number-pad"}
            />
          </View>
          {currency === "USD" ? (
            <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 6 }}>
              ≈ {fmtNaira(Number(amount) || 0)}
            </Text>
          ) : usdEquivalent > 0 ? (
            <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 6 }}>
              ≈ ${usdEquivalent.toFixed(2)}
            </Text>
          ) : null}
          {amountError || limitError ? (
            <Text style={{ color: "#ef4444", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 6 }}>
              {amountError || limitError}
            </Text>
          ) : null}
          {insufficientBank && (
            <Text style={ts.insufficientText}>
              Insufficient. You can send up to {fmtNaira(bankMaxAmount)}
            </Text>
          )}
          {Number(amount) > 0 && !insufficientBank && (
            <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 6 }}>
              ₦{Number(amount).toLocaleString()} + fees = {fmtNaira(bankTotal)}
            </Text>
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ts.chipsRow}>
            {QUICK_AMOUNTS.map((a) => (
              <TouchableOpacity key={a} style={[ts.chip, { borderColor: colors.border, backgroundColor: colors.card }]} onPress={() => setNgn(String(a))}>
                <Text style={[ts.chipText, { color: colors.foreground }]}>₦{a.toLocaleString()}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={[ts.narrationLabel, { color: colors.foreground }]}>Narration (Optional)</Text>
          <View style={[ts.narrationWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <TextInput
              style={[ts.narrationInput, { color: colors.foreground }]}
              placeholder="Type a narration"
              placeholderTextColor={colors.mutedForeground}
              value={narration}
              onChangeText={setNarration}
              multiline
              numberOfLines={3}
            />
          </View>
        </View>
      </ScrollView>
      <View style={[ts.bottomBar, { paddingBottom: bottomPad + 16, backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={[ts.primaryBtn, { backgroundColor: colors.primary, opacity: overLimit ? 0.4 : 1 }]}
          onPress={handleProceed}
          disabled={overLimit}
        >
          <Text style={[ts.primaryBtnText, { color: colors.primaryForeground }]}>Send Funds</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
