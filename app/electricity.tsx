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
import { verifyMeterNumber } from "@/services/bills";

const INPUT_ACCESSORY_ID = "elec-done-bar";

const DISCOS = [
  { id: "IKEDC", name: "IKEDC", label: "Ikeja Electric (Lagos — Ikeja)", logo: require("@/assets/images/ikedc.jpg") },
  { id: "EKEDC", name: "EKEDC", label: "Eko Electric (Lagos — Eko)", logo: require("@/assets/images/ekedc.png") },
  { id: "KEDCO", name: "KEDCO", label: "Kano Electric (Kano, Jigawa, Katsina)", logo: require("@/assets/images/Kedco.jpg") },
  { id: "PHED", name: "PHED", label: "Port Harcourt Electric (Rivers, Bayelsa, Cross River, Akwa Ibom)", logo: require("@/assets/images/PHED.png") },
  { id: "JED", name: "JED", label: "Jos Electric (Plateau, Bauchi, Benue, Gombe)", logo: require("@/assets/images/JED.jpeg") },
  { id: "IBEDC", name: "IBEDC", label: "Ibadan Electric (Oyo, Ogun, Osun, Kwara)", logo: require("@/assets/images/IBEDC.webp") },
  { id: "KAEDCO", name: "KAEDCO", label: "Kaduna Electric (Kaduna, Sokoto, Kebbi, Zamfara)", logo: require("@/assets/images/KAEDCO.jpg") },
  { id: "AEDC", name: "AEDC", label: "Abuja Electric (FCT, Niger, Kogi, Nasarawa)", logo: require("@/assets/images/AEDC-logo.jpg") },
  { id: "EEDC", name: "EEDC", label: "Enugu Electric (Enugu, Abia, Imo, Anambra, Ebonyi)", logo: require("@/assets/images/EEDC.webp") },
  { id: "BEDC", name: "BEDC", label: "Benin Electric (Edo, Delta, Ondo, Ekiti)", logo: require("@/assets/images/bedc.png") },
  { id: "ABEDC", name: "ABEDC", label: "Aba Electric (Abia — Aba)" },
  { id: "YEDC", name: "YEDC", label: "Yola Electric (Adamawa, Borno, Taraba, Yobe)", logo: require("@/assets/images/YEDC.webp") },
];

const METER_TYPES: { key: "prepaid" | "postpaid"; label: string }[] = [
  { key: "prepaid", label: "Prepaid" },
  { key: "postpaid", label: "Postpaid" },
];

const QUICK_AMOUNTS = ["1,000", "2,000", "5,000", "10,000", "20,000", "50,000"];
// Mirrors ELECTRICITY_FEE in backend/src/routes/bills.ts, which is the one
// that actually charges. Shown here so the summary can total it up front.
const ELECTRICITY_FEE = 200;

export default function ElectricityScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { walletReady, user, transactions } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [step, setStep] = useState<"form" | "amount">("form");
  const [selectedDisco, setSelectedDisco] = useState(DISCOS[0]);
  const [showDiscoPicker, setShowDiscoPicker] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [meterType, setMeterType] = useState<"prepaid" | "postpaid">("postpaid");
  const [meterNumber, setMeterNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [meterError, setMeterError] = useState("");
  const [selectedAmount, setSelectedAmount] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [amountError, setAmountError] = useState("");

  const isKycVerified = !!user?.verified;
  const DAILY_LIMIT = isKycVerified ? 20_000 : 5_000;
  const PER_TX_LIMIT = isKycVerified ? 10_000 : 5_000;

  React.useEffect(() => {
    if (!walletReady) {
      Alert.alert("Wallet Required", "Create your wallet first to pay electricity bills.", [{ text: "OK", onPress: () => router.back() }]);
    }
  }, [walletReady]);

  // Reset verification when disco or type changes
  React.useEffect(() => {
    setVerified(false);
    setCustomerName("");
    setMeterError("");
  }, [selectedDisco.id, meterType]);

  const handleVerify = async () => {
    if (!meterNumber || meterNumber.length < 5) {
      setMeterError("Enter a valid meter number");
      return;
    }
    setVerifying(true);
    setMeterError("");
    try {
      const result = await verifyMeterNumber({
        customerId: meterNumber,
        disco: selectedDisco.id,
        type: meterType,
      });
      if (result.verified && result.customerName) {
        setCustomerName(result.customerName);
        setVerified(true);
      } else {
        setMeterError("Could not verify meter. Check the number and try again.");
      }
    } catch (err: any) {
      setMeterError(err?.response?.data?.error || err?.message || "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const handlePay = () => {
    if (!verified) {
      handleVerify();
      return;
    }
    setStep("amount");
  };

  const getAmount = () => {
    const raw = customAmount || "0";
    return Number(raw.replace(/,/g, ""));
  };

  const handleContinue = () => {
    const amt = getAmount();
    if (amt < 1000) { setAmountError("Minimum amount is ₦1,000"); return; }
    if (amt > PER_TX_LIMIT) { setAmountError(`Max per transaction: ₦${PER_TX_LIMIT.toLocaleString()}`); return; }
    setAmountError("");
    router.push({
      pathname: "/electricity-summary",
      params: {
        meterNumber,
        customerName,
        disco: selectedDisco.id,
        discoLabel: selectedDisco.name,
        meterType,
        amount: String(amt),
        fee: String(ELECTRICITY_FEE),
      },
    });
  };

  // Recent electricity purchases
  const recentPurchases = React.useMemo(() => {
    return (transactions || [])
      .filter((t: any) => {
        const m = (t.metadata || t.meta) as any;
        return t.type === "AIRTIME" && m?.billType === "electricity";
      })
      .slice(0, 5);
  }, [transactions]);

  /* ─── AMOUNT STEP ─── */
  if (step === "amount") {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setStep("form")} style={styles.backBtn}>
            <Feather name="arrow-left" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Electricity</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Who this is going to, settled.
              The same shape the verified row had on the step before, so the
              answer you just got does not change appearance when you move on
              from the question. */}
          <View style={styles.payee}>
            {selectedDisco.logo ? (
              <Image source={selectedDisco.logo} style={styles.payeeLogo} />
            ) : (
              <View style={[styles.payeeLogo, { backgroundColor: colors.primary + "1A", alignItems: "center", justifyContent: "center" }]}>
                <Text style={{ color: colors.primary, fontFamily: "Inter_700Bold", fontSize: 10 }}>
                  {selectedDisco.name}
                </Text>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.payeeName, { color: colors.foreground }]} numberOfLines={1}>
                {customerName || meterNumber}
              </Text>
              <Text style={[styles.payeeSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                {meterNumber} · {meterType === "prepaid" ? "Prepaid" : "Postpaid"}
              </Text>
            </View>
            <Ionicons name="checkmark-circle-outline" size={22} color={colors.primary} />
          </View>

          <View style={[styles.rule, { backgroundColor: colors.border }]} />

          {/* The amount, in the shape the rest of the app asks for one: the
              mark, then the figure, on a ruled line. A bordered box here made
              this screen read as a form while every other screen reads as a
              sentence. */}
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
                  setSelectedAmount(null);
                  setAmountError("");
                }}
                keyboardType="number-pad"
                inputAccessoryViewID={Platform.OS === "ios" ? INPUT_ACCESSORY_ID : undefined}
              />
            </View>
            {!!amountError && <Text style={styles.err}>{amountError}</Text>}
            <View style={[styles.rule, { backgroundColor: colors.border, marginHorizontal: 0 }]} />

            <View style={styles.chips}>
              {QUICK_AMOUNTS.filter((amt) => Number(amt.replace(/,/g, "")) <= PER_TX_LIMIT).map((amt) => {
                const on = customAmount === amt.replace(/,/g, "");
                return (
                  <TouchableOpacity
                    key={amt}
                    style={[
                      styles.chip,
                      { backgroundColor: on ? colors.primary : colors.muted },
                    ]}
                    activeOpacity={0.8}
                    onPress={() => {
                      setSelectedAmount(amt);
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

            {!isKycVerified && (
              <Text style={[styles.kycHint, { color: colors.mutedForeground }]}>
                Limit: ₦{PER_TX_LIMIT.toLocaleString()}/tx · ₦{DAILY_LIMIT.toLocaleString()}/day.{" "}
                <Text
                  style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}
                  onPress={() => router.push("/account/limits" as any)}
                >
                  Verify KYC
                </Text>{" "}
                for higher limits.
              </Text>
            )}

            <TouchableOpacity
              style={[
                styles.cta,
                { backgroundColor: colors.primary, opacity: customAmount ? 1 : 0.45 },
              ]}
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
        <Text style={[styles.title, { color: colors.foreground }]}>Electricity</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={[styles.rule, { backgroundColor: colors.border }]} />

        {/* Ruled rows, not boxed fields.
            Every other screen in the app asks its questions on ruled lines -
            airtime, transfers, withdrawals - and this one asked them in three
            outlined boxes, which is why it read as a form somebody had to fill
            rather than as the same app continuing. */}
        <View style={styles.content}>
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => { setShowDiscoPicker(true); setShowTypePicker(false); }}
          >
            {selectedDisco.logo ? (
              <Image source={selectedDisco.logo} style={styles.rowLogo} />
            ) : (
              <View style={[styles.rowLogo, { backgroundColor: colors.primary + "1A", alignItems: "center", justifyContent: "center" }]}>
                <Text style={{ color: colors.primary, fontFamily: "Inter_700Bold", fontSize: 9 }}>
                  {selectedDisco.name}
                </Text>
              </View>
            )}
            <Text style={[styles.rowValue, { color: colors.foreground }]} numberOfLines={1}>
              {selectedDisco.name}
            </Text>
            <Feather name="chevron-down" size={19} color={colors.mutedForeground} />
          </TouchableOpacity>
          <View style={[styles.rule, { backgroundColor: colors.border, marginHorizontal: 0 }]} />

          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => { setShowTypePicker(true); setShowDiscoPicker(false); }}
          >
            <Text style={[styles.rowValue, { color: colors.foreground }]}>
              {meterType === "prepaid" ? "Prepaid" : "Postpaid"}
            </Text>
            <Feather name="chevron-down" size={19} color={colors.mutedForeground} />
          </TouchableOpacity>
          <View style={[styles.rule, { backgroundColor: colors.border, marginHorizontal: 0 }]} />

          <View style={styles.row}>
            <TextInput
              style={[styles.rowInput, { color: colors.foreground }]}
              placeholder="Meter number"
              placeholderTextColor={colors.mutedForeground}
              value={meterNumber}
              onChangeText={(v) => {
                setMeterNumber(v.replace(/[^0-9]/g, ""));
                setVerified(false);
                setCustomerName("");
                setMeterError("");
              }}
              keyboardType="number-pad"
              maxLength={20}
              inputAccessoryViewID={Platform.OS === "ios" ? INPUT_ACCESSORY_ID : undefined}
            />
            {verified && <Ionicons name="checkmark-circle-outline" size={22} color={colors.primary} />}
          </View>
          {!!meterError && <Text style={styles.err}>{meterError}</Text>}
          <View style={[styles.rule, { backgroundColor: colors.border, marginHorizontal: 0 }]} />

          {/* The answer, once we have it. Given its own line rather than a
              tinted box: it is a fact about the meter, not a state of the UI. */}
          {verified && !!customerName && (
            <Text style={[styles.customer, { color: colors.foreground }]} numberOfLines={2}>
              {customerName}
            </Text>
          )}

          <TouchableOpacity
            style={[
              styles.cta,
              {
                backgroundColor: colors.primary,
                opacity: verifying || meterNumber.length < 6 ? 0.45 : 1,
              },
            ]}
            onPress={handlePay}
            disabled={verifying || meterNumber.length < 6}
            activeOpacity={0.85}
          >
            {verifying ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text style={[styles.ctaText, { color: colors.primaryForeground }]}>
                {verified ? "Continue" : "Check meter"}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Recent */}
        <View style={styles.recentSection}>
          <View style={styles.recentHeader}>
            <Text style={[styles.recentTitle, { color: colors.foreground }]}>Recent</Text>
            {recentPurchases.length > 0 && (
              <TouchableOpacity>
                <Text style={[styles.viewAll, { color: colors.foreground }]}>View All</Text>
              </TouchableOpacity>
            )}
          </View>
          {recentPurchases.length === 0 ? (
            <Text style={[styles.noRecent, { color: colors.mutedForeground }]}>No recent purchase</Text>
          ) : (
            recentPurchases.map((tx: any, i: number) => {
              const m = (tx.metadata || tx.meta) as any;
              return (
                <TouchableOpacity
                  key={tx.id || i}
                  style={[styles.recentItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setMeterNumber(m?.phone || "");
                    setCustomerName(m?.customerName || "");
                    const d = DISCOS.find((dd) => dd.id === (m?.disco || m?.network));
                    if (d) setSelectedDisco(d);
                    if (m?.meterType) setMeterType(m.meterType);
                    setVerified(true);
                  }}
                >
                  <Text style={[styles.recentPhone, { color: colors.foreground }]}>{m?.phone}</Text>
                  <Text style={[styles.recentNetwork, { color: colors.mutedForeground }]}>{m?.disco || m?.network}</Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Disco Picker Modal */}
      <Modal transparent animationType="slide" visible={showDiscoPicker}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowDiscoPicker(false)}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card }]} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Biller</Text>
            <TouchableOpacity style={styles.modalClose} onPress={() => setShowDiscoPicker(false)}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <ScrollView showsVerticalScrollIndicator={false}>
              {DISCOS.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  style={[styles.discoItem, { borderBottomColor: colors.border }]}
                  onPress={() => { setSelectedDisco(d); setShowDiscoPicker(false); }}
                >
                  {d.logo ? (
                    <Image source={d.logo} style={styles.discoItemLogo} />
                  ) : (
                    <View style={[styles.discoItemLogo, { backgroundColor: colors.primary + '20', borderRadius: 18, justifyContent: 'center', alignItems: 'center' }]}>
                      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 10 }}>{d.name}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.discoItemName, { color: colors.foreground }]}>{d.name}</Text>
                    <Text style={[styles.discoItemLabel, { color: colors.mutedForeground }]}>{d.label}</Text>
                  </View>
                  <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Type Picker Modal */}
      <Modal transparent animationType="slide" visible={showTypePicker}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowTypePicker(false)}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card }]} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Types</Text>
            <TouchableOpacity style={styles.modalClose} onPress={() => setShowTypePicker(false)}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
            {METER_TYPES.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[styles.typeItem, { borderBottomColor: colors.border }]}
                onPress={() => { setMeterType(t.key); setShowTypePicker(false); }}
              >
                <Text style={[styles.typeItemText, { color: colors.foreground }]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
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
  card: {
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 20,
    marginTop: 8,
  },
  fieldLabel: { fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 8 },

  // ── the app's own row idiom, shared with airtime ──
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: 20 },
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 28 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 58, gap: 10 },
  rowValue: { flex: 1, fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  rowInput: { flex: 1, fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold", padding: 0 },
  rowLogo: { width: 30, height: 30, borderRadius: 8 },
  naira: { width: 17, height: 17, resizeMode: "contain" },
  err: { color: "#ef4444", fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginBottom: 8 },
  customer: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold", paddingTop: 14 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  chipText: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_600SemiBold" },

  cta: { borderRadius: 16, height: 54, alignItems: "center", justifyContent: "center", marginTop: 26 },
  ctaText: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },

  // ── who the money is going to, on the amount step ──
  payee: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 16 },
  payeeLogo: { width: 38, height: 38, borderRadius: 10 },
  payeeName: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_700Bold" },
  payeeSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 1 },

  /* Select row */
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 52,
    gap: 10,
  },
  selectText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  discoLogo: { width: 32, height: 32, borderRadius: 8 },

  /* Input */
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  prefix: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginRight: 6 },

  /* Verified */
  verifiedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
  },
  verifiedName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  /* Buttons */
  continueBtn: {
    backgroundColor: "#0a0a0a",
    borderRadius: 16,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  continueBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },

  /* Amount grid */
  amountGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  amountChip: {
    width: "30.5%",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  amountChipText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  /* Meter info card */
  meterInfoCard: {
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  discoLogoSmall: { width: 40, height: 40, borderRadius: 10 },
  meterInfoNumber: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  meterInfoName: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },

  /* Recent */
  recentSection: {
    marginHorizontal: 20,
    marginTop: 28,
  },
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
  viewAll: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  noRecent: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 40 },
  recentItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  recentPhone: { fontSize: 14, fontFamily: "Inter_500Medium" },
  recentNetwork: { fontSize: 13, fontFamily: "Inter_400Regular" },

  /* Modals */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: "70%",
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#ccc",
    alignSelf: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    marginBottom: 20,
  },
  modalClose: {
    position: "absolute",
    top: 20,
    right: 20,
  },

  /* Disco item */
  discoItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  discoItemLogo: { width: 44, height: 44, borderRadius: 10 },
  discoItemName: { fontSize: 15, fontFamily: "Inter_700Bold" },
  discoItemLabel: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  /* Type item */
  typeItem: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  typeItemText: { fontSize: 16, fontFamily: "Inter_500Medium" },

  errorText: { color: "#ef4444", fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 6 },
  kycHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 8, lineHeight: 17 },

  /* Done bar */
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
