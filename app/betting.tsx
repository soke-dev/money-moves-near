import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  InputAccessoryView,
  Keyboard,
  Alert,
  ActivityIndicator,
  Image,
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { getBettingProviders, verifyBettingAccount } from "@/services/bills";
import { PROVIDER_LOGOS } from "@/constants/bills";

const INPUT_ACCESSORY_ID = "bet-done-bar";

/**
 * The bookmakers, before the server has said which it carries.
 *
 * A fallback rather than the list: /bills/betting-providers is what decides,
 * so a third one can be added without shipping a build. These two are here
 * only so the picker is never empty on a cold start or a failed call.
 */
const FALLBACK_PROVIDERS = ["SportyBet", "Bet9ja"];

/**
 * Mirrors BILL_LIMITS.betting in backend/src/routes/bills.ts, which is the
 * one that actually refuses. The per-transfer figure equals the daily one
 * deliberately: the ceiling given was a daily one, and a smaller per-transfer
 * cap underneath it would refuse a single funding the day plainly allows.
 */
const BETTING_MIN = 100;
// Verified only, so there is one tier rather than two.
const PER_TX_VERIFIED = 10_000;

const QUICK_AMOUNTS = ["100", "200", "500", "1,000", "2,000", "5,000", "10,000"];

export default function BettingScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { walletReady, user, transactions } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [step, setStep] = useState<"form" | "amount">("form");
  const [providers, setProviders] = useState<string[]>(FALLBACK_PROVIDERS);
  const [provider, setProvider] = useState(FALLBACK_PROVIDERS[0]);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerUsername, setCustomerUsername] = useState("");
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  /**
   * The bookmaker's own bounds, learned at verification.
   *
   * Theirs, not ours, and they can be tighter - so the ceiling that actually
   * applies is whichever of the two binds first.
   */
  const [providerMax, setProviderMax] = useState<number | null>(null);
  const [providerMin, setProviderMin] = useState<number | null>(null);

  const isKycVerified = !!user?.verified;
  const PER_TX_LIMIT = Math.min(PER_TX_VERIFIED, providerMax ?? PER_TX_VERIFIED);
  const MIN_AMOUNT = Math.max(BETTING_MIN, providerMin ?? BETTING_MIN);

  React.useEffect(() => {
    if (!walletReady) {
      Alert.alert("Wallet Required", "Create your wallet first to fund a betting account.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    }
  }, [walletReady]);

  React.useEffect(() => {
    let alive = true;
    getBettingProviders()
      .then((r) => {
        if (!alive || !r.providers.length) return;
        setProviders(r.providers);
        // Only move the selection if the server does not carry what is
        // selected; otherwise a slow response would reset a choice already
        // made.
        setProvider((p) => (r.providers.includes(p) ? p : r.providers[0]));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // A verified name belongs to the account it was looked up for, so changing
  // the bookmaker throws it away rather than showing one provider's customer
  // beside another's name.
  React.useEffect(() => {
    setVerified(false);
    setCustomerName("");
    setCustomerUsername("");
    setAccountError("");
    setProviderMin(null);
    setProviderMax(null);
  }, [provider]);

  const handleVerify = async () => {
    const id = accountId.trim();
    if (id.length < 5) {
      setAccountError("Enter your betting account ID");
      return;
    }
    setVerifying(true);
    setAccountError("");
    try {
      const r = await verifyBettingAccount({ customerId: id, provider });
      if (r.verified && r.customerName) {
        setCustomerName(r.customerName);
        setCustomerUsername(r.customerUsername || "");
        if (Number.isFinite(r.minAmount)) setProviderMin(Number(r.minAmount));
        if (Number.isFinite(r.maxAmount)) setProviderMax(Number(r.maxAmount));
        setVerified(true);
      } else {
        setAccountError("We could not find that account. Check the ID and try again.");
      }
    } catch (err: any) {
      setAccountError(err?.response?.data?.error || err?.message || "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const handleNext = () => {
    if (!verified) {
      handleVerify();
      return;
    }
    setStep("amount");
  };

  const getAmount = () => Number((customAmount || "0").replace(/,/g, ""));

  const handleContinue = () => {
    const amt = getAmount();
    if (amt < MIN_AMOUNT) {
      setAmountError(`Minimum amount is ₦${MIN_AMOUNT.toLocaleString()}`);
      return;
    }
    if (amt > PER_TX_LIMIT) {
      setAmountError(`Max per transaction: ₦${PER_TX_LIMIT.toLocaleString()}`);
      return;
    }
    setAmountError("");
    router.push({
      pathname: "/betting-summary",
      params: {
        accountId: accountId.trim(),
        // Only a real name travels. An echoed id would print as an "Account
        // Name" row on the summary and the receipt saying nothing.
        customerName: realName,
        provider,
        amount: String(amt),
      },
    });
  };

  /**
   * What the lookup actually told us, minus the echoes.
   *
   * SportyBet returns the phone number as both customer_name and
   * customer_username - it does not hold a display name at all, not even in
   * its own dashboard - so the literal rendering of its reply is
   * "08012345678 · 08012345678" printed directly under the 08012345678 you
   * just typed. Three copies of one number is not a confirmation.
   *
   * So anything that merely repeats the id, or repeats the other field, is
   * dropped. Bet9ja does return a real name and it survives this untouched.
   */
  const realName = React.useMemo(() => {
    const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
    const id = norm(accountId);
    const parts: string[] = [];
    for (const v of [customerName, customerUsername]) {
      const t = (v || "").trim();
      if (!t || norm(t) === id) continue;
      if (parts.some((p) => norm(p) === norm(t))) continue;
      parts.push(t);
    }
    return parts.join(" · ");
  }, [customerName, customerUsername, accountId]);

  // When the provider holds no name, the fact of the match is the only thing
  // it really said - so say that instead of the number back again.
  const accountLabel = realName || "Account found";

  const recentPurchases = React.useMemo(() => {
    return (transactions || [])
      .filter((t: any) => {
        const m = (t.metadata || t.meta) as any;
        return t.type === "AIRTIME" && m?.billType === "betting";
      })
      .slice(0, 5);
  }, [transactions]);

  /**
   * Verified only.
   *
   * The server refuses this at both /verify-betting and /prepare, so this is
   * not the enforcement - it is so the refusal arrives before somebody picks
   * a bookmaker and types an account id, rather than after.
   *
   * Placed below every hook on purpose: an early return above one of them
   * changes the hook order between renders.
   */
  if (!isKycVerified) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Betting</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={[styles.rule, { backgroundColor: colors.border }]} />

        <View style={styles.locked}>
          <View style={[styles.lockedDisc, { backgroundColor: colors.muted }]}>
            <Feather name="lock" size={21} color={colors.mutedForeground} />
          </View>
          <Text style={[styles.lockedTitle, { color: colors.foreground }]}>
            Verify your ID first
          </Text>
          <Text style={[styles.lockedBody, { color: colors.mutedForeground }]}>
            Funding a betting account needs a verified identity. It takes a few
            minutes, and it lifts your other limits at the same time.
          </Text>
          <TouchableOpacity
            style={[styles.cta, styles.lockedCta, { backgroundColor: colors.primary }]}
            onPress={() => router.push("/account/kyc" as any)}
            activeOpacity={0.85}
          >
            <Text style={[styles.ctaText, { color: colors.primaryForeground }]}>Verify my ID</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  /**
   * The bookmaker's mark, or its initials.
   *
   * PROVIDER_LOGOS is deliberately partial - it is the same map the recents
   * row reads - so a bookmaker added later shows initials rather than an
   * empty square until artwork arrives for it.
   */
  const Mark = ({ name, size }: { name: string; size: number }) => {
    const logo = PROVIDER_LOGOS[name.toUpperCase()];
    if (logo) {
      return (
        <Image
          source={logo}
          style={{ width: size, height: size, borderRadius: size / 4 }}
          resizeMode="contain"
        />
      );
    }
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 4,
          backgroundColor: colors.primary + "1A",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            color: colors.primary,
            fontFamily: "Inter_700Bold",
            fontSize: size * 0.32,
          }}
        >
          {name.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase()}
        </Text>
      </View>
    );
  };

  /* ─── AMOUNT STEP ─── */
  if (step === "amount") {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setStep("form")} style={styles.backBtn}>
            <Feather name="arrow-left" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Betting</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Who this is going to, settled. Same shape as the verified row on
              the step before, so the answer does not change appearance when
              you move past the question. */}
          <View style={styles.payee}>
            <Mark name={provider} size={38} />
            {/* The id leads when there is no name to lead with, and the
                bookmaker stands alone underneath — rather than the id
                appearing on both lines. */}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.payeeName, { color: colors.foreground }]} numberOfLines={1}>
                {realName || accountId}
              </Text>
              <Text style={[styles.payeeSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                {realName ? `${provider} · ${accountId}` : provider}
              </Text>
            </View>
            <Ionicons name="checkmark-circle-outline" size={22} color={colors.primary} />
          </View>

          <View style={[styles.rule, { backgroundColor: colors.border }]} />

          <View style={styles.content}>
            <View style={styles.row}>
              <Image
                source={require("@/assets/images/nairaiconnew.png")}
                style={[
                  styles.naira,
                  { tintColor: customAmount ? colors.foreground : colors.mutedForeground },
                ]}
              />
              <TextInput
                style={[styles.rowInput, { color: colors.foreground }]}
                placeholder="Amount"
                placeholderTextColor={colors.mutedForeground}
                value={customAmount ? Number(customAmount).toLocaleString() : ""}
                onChangeText={(v) => {
                  setCustomAmount(v.replace(/[^0-9]/g, "").slice(0, 7));
                  setAmountError("");
                }}
                keyboardType="number-pad"
                inputAccessoryViewID={Platform.OS === "ios" ? INPUT_ACCESSORY_ID : undefined}
              />
            </View>
            {!!amountError && <Text style={styles.err}>{amountError}</Text>}
            <View style={[styles.rule, { backgroundColor: colors.border, marginHorizontal: 0 }]} />

            <View style={styles.chips}>
              {QUICK_AMOUNTS.filter((a) => {
                const n = Number(a.replace(/,/g, ""));
                return n >= MIN_AMOUNT && n <= PER_TX_LIMIT;
              }).map((amt) => {
                const on = customAmount === amt.replace(/,/g, "");
                return (
                  <TouchableOpacity
                    key={amt}
                    style={[styles.chip, { backgroundColor: on ? colors.primary : colors.muted }]}
                    activeOpacity={0.8}
                    onPress={() => {
                      setCustomAmount(amt.replace(/,/g, ""));
                      setAmountError("");
                    }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: on ? colors.primaryForeground : colors.foreground },
                      ]}
                    >
                      ₦{amt}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Stated plainly rather than only on refusal: the ceiling is low
                enough here that somebody will meet it, and meeting it as a
                surprise at Continue is worse than reading it first. */}
            <Text style={[styles.kycHint, { color: colors.mutedForeground }]}>
              ₦{MIN_AMOUNT.toLocaleString()} minimum · ₦{PER_TX_LIMIT.toLocaleString()} a day.
            </Text>

            <TouchableOpacity
              style={[styles.cta, { backgroundColor: colors.primary, opacity: customAmount ? 1 : 0.45 }]}
              onPress={handleContinue}
              disabled={!customAmount}
              activeOpacity={0.85}
            >
              <Text style={[styles.ctaText, { color: colors.primaryForeground }]}>Continue</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {Platform.OS === "ios" && (
          <InputAccessoryView nativeID={INPUT_ACCESSORY_ID}>
            <View style={[styles.doneBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={() => Keyboard.dismiss()} style={styles.doneBtn}>
                <Text style={[styles.doneBtnText, { color: colors.primary }]}>Done</Text>
              </TouchableOpacity>
            </View>
          </InputAccessoryView>
        )}
      </View>
    );
  }

  /* ─── FORM STEP ─── */
  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Betting</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.rule, { backgroundColor: colors.border }]} />

        {/* Ruled rows, not boxed fields — the idiom the rest of the app asks
            its questions in. */}
        <View style={styles.content}>
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => setShowProviderPicker(true)}
          >
            <Mark name={provider} size={30} />
            <Text style={[styles.rowValue, { color: colors.foreground }]}>{provider}</Text>
            <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>

          <View style={[styles.rule, { backgroundColor: colors.border, marginHorizontal: 0 }]} />

          <View style={styles.row}>
            <TextInput
              style={[styles.rowInput, { color: colors.foreground }]}
              placeholder="Betting account ID"
              placeholderTextColor={colors.mutedForeground}
              value={accountId}
              onChangeText={(v) => {
                setAccountId(v.trim());
                setVerified(false);
                setCustomerName("");
                setAccountError("");
              }}
              autoCapitalize="none"
              autoCorrect={false}
              inputAccessoryViewID={Platform.OS === "ios" ? INPUT_ACCESSORY_ID : undefined}
            />
            {verifying && <ActivityIndicator size="small" color={colors.primary} />}
          </View>

          {!!accountError && <Text style={styles.err}>{accountError}</Text>}

          {/* The name we found, stated plainly. It is the only thing standing
              between a typo and somebody else's account being topped up. */}
          {verified && (
            <Text style={[styles.customer, { color: colors.primary }]}>
              {accountLabel}
            </Text>
          )}

          <View style={[styles.rule, { backgroundColor: colors.border, marginHorizontal: 0, marginTop: 14 }]} />

          <TouchableOpacity
            style={[
              styles.cta,
              { backgroundColor: colors.primary, opacity: accountId.trim().length >= 5 && !verifying ? 1 : 0.45 },
            ]}
            onPress={handleNext}
            disabled={accountId.trim().length < 5 || verifying}
            activeOpacity={0.85}
          >
            <Text style={[styles.ctaText, { color: colors.primaryForeground }]}>
              {verifying ? "Checking" : verified ? "Continue" : "Check account"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Recent */}
        <View style={styles.recentSection}>
          <View style={styles.recentHeader}>
            <Text style={[styles.recentTitle, { color: colors.foreground }]}>Recent</Text>
          </View>
          {recentPurchases.length === 0 ? (
            <Text style={[styles.noRecent, { color: colors.mutedForeground }]}>No recent top-up</Text>
          ) : (
            recentPurchases.map((tx: any, i: number) => {
              const m = (tx.metadata || tx.meta) as any;
              return (
                <TouchableOpacity
                  key={tx.id || i}
                  style={[styles.recentItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setAccountId(m?.phone || "");
                    setCustomerName(m?.customerName || "");
                    if (m?.network && providers.includes(m.network)) setProvider(m.network);
                    // Not marked verified: the name is last week's, and the
                    // account could have been closed since. One tap re-checks.
                    setVerified(false);
                  }}
                >
                  <Text style={[styles.recentPhone, { color: colors.foreground }]}>{m?.phone}</Text>
                  <Text style={[styles.recentNetwork, { color: colors.mutedForeground }]}>{m?.network}</Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Provider Picker Modal */}
      <Modal transparent animationType="slide" visible={showProviderPicker}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowProviderPicker(false)}
        >
          <View
            style={[styles.modalSheet, { backgroundColor: colors.card }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Bookmaker</Text>
            <TouchableOpacity style={styles.modalClose} onPress={() => setShowProviderPicker(false)}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <ScrollView showsVerticalScrollIndicator={false}>
              {providers.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.discoItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setProvider(p);
                    setShowProviderPicker(false);
                  }}
                >
                  <Mark name={p} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.discoItemName, { color: colors.foreground }]}>{p}</Text>
                  </View>
                  {p === provider ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  ) : (
                    <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {Platform.OS === "ios" && (
        <InputAccessoryView nativeID={INPUT_ACCESSORY_ID}>
          <View style={[styles.doneBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => Keyboard.dismiss()} style={styles.doneBtn}>
              <Text style={[styles.doneBtnText, { color: colors.primary }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}
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
    paddingVertical: 16,
  },
  backBtn: { width: 24 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },

  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: 20 },
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 28 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 58, gap: 10 },
  rowValue: { flex: 1, fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  rowInput: { flex: 1, fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold", padding: 0 },
  naira: { width: 17, height: 17, resizeMode: "contain" },
  err: { color: "#ef4444", fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginBottom: 8 },
  customer: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold", paddingTop: 14 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  chipText: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_600SemiBold" },

  cta: { borderRadius: 16, height: 54, alignItems: "center", justifyContent: "center", marginTop: 26 },
  ctaText: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },

  payee: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 16 },
  payeeName: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_700Bold" },
  payeeSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 1 },

  recentSection: { marginHorizontal: 20, marginTop: 28 },
  recentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: "#0a0a0a",
    paddingBottom: 8,
    alignSelf: "flex-start",
  },
  recentTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  noRecent: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 40 },
  recentItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  recentPhone: { fontSize: 14, fontFamily: "Inter_500Medium" },
  recentNetwork: { fontSize: 13, fontFamily: "Inter_400Regular" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "70%" },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#ccc",
    alignSelf: "center",
    marginBottom: 16,
  },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 20 },
  modalClose: { position: "absolute", top: 20, right: 20 },

  discoItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  discoItemName: { fontSize: 15, fontFamily: "Inter_700Bold" },

  kycHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 8, lineHeight: 17 },

  locked: { paddingHorizontal: 32, paddingTop: 72, alignItems: "center" },
  lockedDisc: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  lockedTitle: { fontSize: 17, lineHeight: 23, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  lockedBody: {
    fontSize: 13.5,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 8,
  },
  lockedCta: { alignSelf: "stretch" },

  doneBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  doneBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  doneBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
