import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal,
  Image,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { getCablePackages, verifySmartcard, type CablePackage } from "@/services/bills";
import { getTransactions } from "@/services/transactions";
import { fmtNaira } from "@/constants/transfer";

/**
 * Cable TV, built on what the provider actually sells.
 *
 * The screen this replaces carried a hardcoded package list and an invented
 * exchange rate. DStv Padi was ₦2,950 in it and is ₦4,400 in reality - a price
 * that stale is not a cosmetic problem, it is a number somebody would have
 * agreed to pay. Packages come from the provider now, with their codes, and
 * the code is what gets bought.
 */

const PROVIDERS: { id: string; name: string; logo: any }[] = [
  { id: "DSTV", name: "DStv", logo: require("@/assets/images/dstv.webp") },
  { id: "GOtv", name: "GOtv", logo: require("@/assets/images/gotv.png") },
  { id: "StarTimes", name: "StarTimes", logo: require("@/assets/images/startimes.webp") },
];

const INPUT_ACCESSORY_ID = "tv-done-bar";

export default function TVScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { walletReady } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [showProviderPicker, setShowProviderPicker] = useState(false);

  const [packages, setPackages] = useState<CablePackage[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(true);
  const [pkg, setPkg] = useState<CablePackage | null>(null);
  const [showPackagePicker, setShowPackagePicker] = useState(false);

  const [smartcard, setSmartcard] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  const [recent, setRecent] = useState<{ id: string; label: string; provider: string }[]>([]);

  // ── Packages, per provider ───────────────────────────────
  useEffect(() => {
    let alive = true;
    setLoadingPackages(true);
    setPkg(null);
    setVerified(false);
    setCustomerName("");

    getCablePackages(provider.id)
      .then((list) => {
        if (!alive) return;
        setPackages(list);
        setLoadingPackages(false);
      })
      .catch(() => {
        if (!alive) return;
        setPackages([]);
        setLoadingPackages(false);
      });

    return () => {
      alive = false;
    };
  }, [provider.id]);

  // ── What they paid last ──────────────────────────────────
  useEffect(() => {
    getTransactions({ type: "AIRTIME", limit: 20 })
      .then((r) => {
        const seen = new Set<string>();
        const list: typeof recent = [];
        for (const t of r.transactions) {
          const meta: any = (t as any).metadata || {};
          if (meta.billType !== "cable" || !meta.phone) continue;
          if (seen.has(meta.phone)) continue;
          seen.add(meta.phone);
          list.push({ id: t.id, label: meta.phone, provider: meta.network || "" });
        }
        setRecent(list.slice(0, 4));
      })
      .catch(() => {});
  }, []);

  const canVerify = smartcard.trim().length >= 8 && !!pkg;

  const check = useCallback(async () => {
    if (!canVerify || !pkg) return;
    setVerifying(true);
    setError("");
    try {
      const r = await verifySmartcard({
        smartcard: smartcard.trim(),
        provider: provider.id,
        packageCode: pkg.code,
      });
      setCustomerName(r.customerName);
      setVerified(true);
    } catch (e: any) {
      setVerified(false);
      setCustomerName("");
      setError(e?.response?.data?.error || "We could not find that smartcard number.");
    } finally {
      setVerifying(false);
    }
  }, [canVerify, pkg, smartcard, provider.id]);

  const proceed = () => {
    if (!pkg) return;
    if (!verified) {
      check();
      return;
    }
    router.push({
      pathname: "/tv-summary",
      params: {
        provider: provider.id,
        providerName: provider.name,
        smartcard: smartcard.trim(),
        customerName,
        packageCode: pkg.code,
        packageName: pkg.name,
        amount: String(pkg.amount),
      },
    } as any);
  };

  useEffect(() => {
    if (!walletReady) router.back();
  }, [walletReady]);

  const cta = useMemo(() => {
    if (verifying) return "";
    if (!pkg) return "Choose a package";
    if (!verified) return "Check smartcard";
    return "Continue";
  }, [verifying, pkg, verified]);

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>Cable TV</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.rule, { backgroundColor: colors.border }]} />

        {/* Ruled rows, the same way airtime and electricity ask their
            questions. A stack of outlined boxes reads as a form; these read as
            the app continuing. */}
        <View style={s.content}>
          <TouchableOpacity
            style={s.row}
            activeOpacity={0.7}
            onPress={() => setShowProviderPicker(true)}
          >
            <Image source={provider.logo} style={s.rowLogo} resizeMode="contain" />
            <Text style={[s.rowValue, { color: colors.foreground }]}>{provider.name}</Text>
            <Feather name="chevron-down" size={19} color={colors.mutedForeground} />
          </TouchableOpacity>
          <View style={[s.rule, { backgroundColor: colors.border, marginHorizontal: 0 }]} />

          <TouchableOpacity
            style={s.row}
            activeOpacity={0.7}
            onPress={() => packages.length > 0 && setShowPackagePicker(true)}
            disabled={loadingPackages || packages.length === 0}
          >
            {loadingPackages ? (
              <>
                <ActivityIndicator size="small" color={colors.mutedForeground} />
                <Text style={[s.rowValue, { color: colors.mutedForeground }]}>Loading packages…</Text>
              </>
            ) : packages.length === 0 ? (
              <Text style={[s.rowValue, { color: colors.mutedForeground }]}>No packages right now</Text>
            ) : (
              <>
                {/* `flex: 0` on purpose.
                    rowValue carries flex: 1 so it fills the row when it sits
                    directly in it. Nested inside this wrapper - which is the
                    flexing one - that same rule made the Text stretch to the
                    row's full height and settle at the top of it, while the
                    chevron stayed centred beside it. */}
                <View style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
                  <Text
                    style={[
                      s.rowValue,
                      { flex: 0, color: pkg ? colors.foreground : colors.mutedForeground },
                    ]}
                    numberOfLines={1}
                  >
                    {pkg ? pkg.name : "Choose a package"}
                  </Text>
                  {!!pkg && (
                    <Text style={[s.rowSub, { color: colors.mutedForeground }]}>
                      {fmtNaira(pkg.amount)}
                    </Text>
                  )}
                </View>
                <Feather name="chevron-down" size={19} color={colors.mutedForeground} />
              </>
            )}
          </TouchableOpacity>
          <View style={[s.rule, { backgroundColor: colors.border, marginHorizontal: 0 }]} />

          <View style={s.row}>
            <TextInput
              style={[s.rowInput, { color: colors.foreground }]}
              placeholder="Smartcard number"
              placeholderTextColor={colors.mutedForeground}
              value={smartcard}
              onChangeText={(v) => {
                setSmartcard(v.replace(/[^0-9]/g, ""));
                setVerified(false);
                setCustomerName("");
                setError("");
              }}
              keyboardType="number-pad"
              maxLength={20}
              inputAccessoryViewID={Platform.OS === "ios" ? INPUT_ACCESSORY_ID : undefined}
            />
            {verified && <Ionicons name="checkmark-circle-outline" size={22} color={colors.primary} />}
          </View>
          {!!error && <Text style={s.err}>{error}</Text>}
          <View style={[s.rule, { backgroundColor: colors.border, marginHorizontal: 0 }]} />

          {/* A fact about the decoder, not a state of the UI, so it gets a line
              rather than a tinted box. */}
          {verified && !!customerName && (
            <Text style={[s.customer, { color: colors.foreground }]} numberOfLines={2}>
              {customerName}
            </Text>
          )}

          <TouchableOpacity
            style={[
              s.cta,
              { backgroundColor: colors.primary, opacity: !pkg || verifying || !smartcard ? 0.45 : 1 },
            ]}
            onPress={proceed}
            disabled={!pkg || verifying || !smartcard}
            activeOpacity={0.85}
          >
            {verifying ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text style={[s.ctaText, { color: colors.primaryForeground }]}>{cta}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Recent */}
        {recent.length > 0 && (
          <View style={s.recent}>
            <Text style={[s.recentTitle, { color: colors.foreground }]}>Recent</Text>
            {recent.map((r) => {
              const p = PROVIDERS.find((x) => x.id === r.provider);
              return (
                <TouchableOpacity
                  key={r.id}
                  style={[s.recentRow, { backgroundColor: colors.card }]}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (p) setProvider(p);
                    setSmartcard(r.label);
                    setVerified(false);
                    setCustomerName("");
                  }}
                >
                  {p ? (
                    <Image source={p.logo} style={s.recentLogo} resizeMode="contain" />
                  ) : (
                    <View style={[s.recentLogo, { backgroundColor: colors.muted }]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[s.recentLabel, { color: colors.foreground }]}>{r.label}</Text>
                    <Text style={[s.recentSub, { color: colors.mutedForeground }]}>
                      {p?.name || r.provider}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* ── Provider picker ── */}
      <Modal visible={showProviderPicker} transparent animationType="slide">
        <TouchableOpacity
          style={s.overlay}
          activeOpacity={1}
          onPress={() => setShowProviderPicker(false)}
        >
          <View
            style={[s.sheet, { backgroundColor: colors.card, paddingBottom: (insets.bottom || 12) + 16 }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={[s.grip, { backgroundColor: colors.border }]} />
            <Text style={[s.sheetTitle, { color: colors.foreground }]}>Provider</Text>
            {PROVIDERS.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={s.pickRow}
                onPress={() => {
                  setProvider(p);
                  setShowProviderPicker(false);
                }}
                activeOpacity={0.7}
              >
                <Image source={p.logo} style={s.logo} resizeMode="contain" />
                <Text style={[s.pickText, { color: colors.foreground, flex: 1 }]}>{p.name}</Text>
                {provider.id === p.id && <Feather name="check" size={18} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Package picker ── */}
      <Modal visible={showPackagePicker} transparent animationType="slide">
        <TouchableOpacity
          style={s.overlay}
          activeOpacity={1}
          onPress={() => setShowPackagePicker(false)}
        >
          <View
            style={[
              s.sheet,
              { backgroundColor: colors.card, paddingBottom: (insets.bottom || 12) + 16, maxHeight: "78%" },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <View style={[s.grip, { backgroundColor: colors.border }]} />
            <Text style={[s.sheetTitle, { color: colors.foreground }]}>{provider.name} packages</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {packages.map((p) => (
                <TouchableOpacity
                  key={p.code}
                  style={s.pickRow}
                  onPress={() => {
                    setPkg(p);
                    setShowPackagePicker(false);
                    setVerified(false);
                    setCustomerName("");
                  }}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.pickText, { color: colors.foreground }]}>{p.name}</Text>
                  </View>
                  <Text style={[s.pickPrice, { color: colors.foreground }]}>{fmtNaira(p.amount)}</Text>
                  {pkg?.code === p.code && (
                    <Feather name="check" size={18} color={colors.primary} style={{ marginLeft: 8 }} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
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
  rowSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 1 },
  rowInput: { flex: 1, fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold", padding: 0 },
  rowLogo: { width: 34, height: 26, borderRadius: 6 },
  err: { color: "#ef4444", fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginBottom: 8 },
  customer: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold", paddingTop: 14 },
  fieldLabel: { fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 8 },

  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    minHeight: 52,
    gap: 10,
  },
  selectText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  selectSub: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 2 },
  // Contained rather than cropped: these are three different logos on three
  // different grounds, and a square crop would cut two of them.
  logo: { width: 34, height: 26, borderRadius: 6 },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  errorText: { fontSize: 12.5, fontFamily: "Inter_400Regular", marginTop: 8 },

  verifiedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
  },
  verifiedName: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },

  cta: { borderRadius: 16, height: 52, alignItems: "center", justifyContent: "center", marginTop: 24 },
  ctaText: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },

  recent: { marginTop: 28, paddingHorizontal: 20, gap: 10 },
  recentTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 2 },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    padding: 14,
  },
  recentLogo: { width: 34, height: 26, borderRadius: 6 },
  recentLabel: { fontSize: 14.5, fontFamily: "Inter_600SemiBold" },
  recentSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 10 },
  grip: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  sheetTitle: { fontSize: 20, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.6, marginBottom: 10, paddingHorizontal: 4 },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15, paddingHorizontal: 4 },
  pickText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  pickPrice: { fontSize: 14.5, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
});
