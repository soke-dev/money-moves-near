import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  Keyboard,
  Alert,
  ActivityIndicator,
  Modal,
  FlatList,
  Image,
  Animated,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import * as Contacts from "expo-contacts";
import { getDataPlans } from "@/services/bills";
import { TokenLogo } from "@/components/TokenLogo";
import { assetLabel, fmtNaira, FONT_SCALE } from "@/constants/transfer";
import { PROVIDER_LOGOS } from "@/constants/bills";

const RECENT_AIRTIME_KEY = "@recentAirtimeNumbers";

type Tab = "airtime" | "data";
type DataCategory = "popular" | "daily" | "weekly" | "monthly" | "broadband";

/** Chains, named the way they are spoken rather than by their tag. */
const CHAIN_NAMES: Record<string, string> = {
  MOVE: "Movement",
  BASE: "Base",
  SOL: "Solana",
  BEP20: "BNB Smart Chain",
  ARB: "Arbitrum",
  ARC: "Arc",
  TON: "TON",
  STELLAR: "Stellar",
  MONAD: "Monad",
};

const NETWORKS = [
  { name: "MTN", color: "#FFCC00", textColor: "#000", abbr: "MTN" },
  { name: "Airtel", color: "#FF0000", textColor: "#fff", abbr: "AIR" },
  { name: "Glo", color: "#00A651", textColor: "#fff", abbr: "GLO" },
  { name: "9Mobile", color: "#006633", textColor: "#fff", abbr: "9M" },
];

const AIRTIME_AMOUNTS = ["100", "500", "1,000", "2,000", "5,000", "10,000"];

interface DataPlan {
  label: string;
  price: string;
  validity: string;
  bonus?: string;
  variationId?: string;
}

// Hardcoded plans used as fallback when VTU.ng API is unavailable
const FALLBACK_DATA_PLANS: Record<DataCategory, DataPlan[]> = {
  popular: [
    { label: "1GB", price: "500", validity: "1 day", bonus: "1.5mins" },
    { label: "2.5GB", price: "900", validity: "2 days" },
    { label: "500MB", price: "500", validity: "7 days", bonus: "YT-1GB" },
    { label: "1GB", price: "800", validity: "7 days", bonus: "5mins" },
    { label: "2GB", price: "1,500", validity: "30 days", bonus: "2mins" },
    { label: "3.5GB", price: "2,500", validity: "30 days", bonus: "5mins" },
  ],
  daily: [
    { label: "100MB", price: "100", validity: "1 day" },
    { label: "200MB", price: "200", validity: "1 day" },
    { label: "1GB", price: "500", validity: "1 day", bonus: "1.5mins" },
    { label: "2.5GB", price: "900", validity: "2 days" },
    { label: "3GB", price: "1,000", validity: "3 days" },
  ],
  weekly: [
    { label: "500MB", price: "500", validity: "7 days", bonus: "YT-1GB" },
    { label: "1GB", price: "800", validity: "7 days", bonus: "5mins" },
    { label: "5GB", price: "2,500", validity: "7 days" },
    { label: "20GB", price: "5,000", validity: "7 days" },
  ],
  monthly: [
    { label: "2GB", price: "1,500", validity: "30 days", bonus: "2mins" },
    { label: "2.7GB", price: "2,000", validity: "30 days", bonus: "2mins + Night-2GB..." },
    { label: "3.5GB", price: "2,500", validity: "30 days", bonus: "5mins" },
    { label: "5GB", price: "3,500", validity: "30 days" },
    { label: "10GB", price: "5,000", validity: "30 days" },
    { label: "20GB", price: "7,500", validity: "30 days" },
    { label: "40GB", price: "12,000", validity: "30 days" },
  ],
  broadband: [
    { label: "75GB", price: "15,000", validity: "30 days" },
    { label: "120GB", price: "20,000", validity: "30 days" },
    { label: "200GB", price: "30,000", validity: "60 days" },
  ],
};

const DATA_CATEGORIES: { key: DataCategory; label: string }[] = [
  { key: "popular", label: "Popular" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "broadband", label: "Broadband" },
];

export default function AirtimeScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { transactions, user, walletReady, walletBalances, rates } = useApp();
  const params = useLocalSearchParams<{ tab?: string }>();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const verified = !!user?.verified;

  useEffect(() => {
    if (!walletReady) {
      Alert.alert("Wallet Required", "Create your wallet first to buy airtime.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    }
  }, [walletReady]);

  const DAILY_LIMIT = verified ? 10000 : 3000;
  const PER_TX_LIMIT = verified ? 5000 : 1000;

  const [tab] = useState<Tab>((params.tab as Tab) || "airtime");
  const isData = tab === "data";

  // null until chosen, so the row can read "Select provider" the way the
  // design does rather than presuming MTN on everyone's behalf.
  const [network, setNetwork] = useState<(typeof NETWORKS)[0] | null>(null);
  const [showProviders, setShowProviders] = useState(false);
  const [phone, setPhone] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [dataCategory, setDataCategory] = useState<DataCategory>("popular");
  const [selectedPlan, setSelectedPlan] = useState<DataPlan | null>(null);
  const [showPlans, setShowPlans] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [amountError, setAmountError] = useState("");
  const [liveDataPlans, setLiveDataPlans] = useState<DataPlan[] | null>(null);
  const [plansLoading, setPlansLoading] = useState(false);
  const [storedRecent, setStoredRecent] = useState<{ phone: string; network: string }[]>([]);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactList, setContactList] = useState<{ name: string; phone: string }[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [contactsLoading, setContactsLoading] = useState(false);

  // ─── What pays for it ────────────────────────────────────
  const [wallet, setWallet] = useState<{ asset: string; chain: string; balance: number } | null>(null);
  const [showWallets, setShowWallets] = useState(false);

  const lift = useRef(new Animated.Value(0)).current;

  // ─── Recents ─────────────────────────────────────────────
  const loadRecent = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(RECENT_AIRTIME_KEY);
      setStoredRecent(raw ? JSON.parse(raw) : []);
    } catch {}
  }, []);
  useFocusEffect(useCallback(() => { loadRecent(); }, [loadRecent]));

  // ─── Data plans ──────────────────────────────────────────
  const fetchPlans = useCallback(async (networkName: string) => {
    setPlansLoading(true);
    try {
      const result = await getDataPlans(networkName);
      const variations = result?.variations || result?.data || result || [];
      if (Array.isArray(variations) && variations.length > 0) {
        /**
         * The provider calls the plan `data_plan`, and writes it as
         * "10GB - 30 Days".
         *
         * Nothing here read that field, so every row fell through to the
         * variation id and the list was a column of numbers like 5580757.
         * Splitting it gives the size as the line you read and the term as
         * the line under it.
         *
         * It also marks plans Unavailable. Those were being listed and were
         * selectable, so a purchase could only fail after the PIN.
         */
        const mapped = variations
          .filter(
            (v: any) => String(v.availability ?? "Available").toLowerCase() !== "unavailable",
          )
          .map((v: any) => {
            const raw = String(v.data_plan || v.name || v.plan || "").trim();
            const [size, ...term] = raw.split(" - ");
            return {
              label: size.trim() || String(v.variation_id ?? ""),
              validity: term.join(" - ").trim() || v.validity || v.duration || "",
              price: String(v.price ?? v.amount ?? 0),
              variationId: String(v.variation_id ?? v.variationId ?? v.id ?? ""),
            };
          })
          // Cheapest first: the list arrives in no order at all.
          .sort((a: any, b: any) => Number(a.price) - Number(b.price));

        setLiveDataPlans(mapped.length > 0 ? mapped : null);
      } else {
        setLiveDataPlans(null);
      }
    } catch {
      setLiveDataPlans(null);
    } finally {
      setPlansLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isData && network) fetchPlans(network.name);
  }, [network?.name, isData, fetchPlans]);

  const plans = liveDataPlans || FALLBACK_DATA_PLANS[dataCategory] || [];

  // ─── Wallets that can pay ────────────────────────────────
  /**
   * Same rule the summary uses: native Movement USDC is held as USDCx, and the
   * bridged USDC.e on Movement is withdrawal-only, so it cannot pay a bill.
   */
  const eligibleWallets = useMemo(
    () =>
      walletBalances
        .filter(
          (w) =>
            w.balance >= 0.0001 &&
            !(w.asset === "USDC" && w.chain === "MOVE") &&
            ["USDC", "USDT", "MOVE", "USDCx"].includes(w.asset),
        )
        .sort((a, b) => {
          const aUsd = a.balance * ((rates?.[a.asset as keyof typeof rates] as any)?.usd || 0);
          const bUsd = b.balance * ((rates?.[b.asset as keyof typeof rates] as any)?.usd || 0);
          return bUsd - aUsd;
        }),
    [walletBalances, rates],
  );

  const nairaAmount = isData
    ? selectedPlan
      ? Number(selectedPlan.price.replace(/,/g, ""))
      : 0
    : Number(customAmount.replace(/,/g, "")) || 0;

  /** What a wallet's balance is worth in naira, for the card and the picker. */
  const walletNaira = useCallback(
    (w: { asset: string; balance: number }) => {
      const r = rates?.[w.asset as keyof typeof rates] as any;
      return w.balance * (r?.ngn || 0);
    },
    [rates],
  );

  // Default to the wallet that can actually cover this purchase, falling back
  // to the largest. Re-runs as the amount changes, but never overrides a
  // wallet the user picked themselves.
  const touchedWallet = useRef(false);
  useEffect(() => {
    if (touchedWallet.current || eligibleWallets.length === 0) return;
    const affordable = eligibleWallets.find((w) => walletNaira(w) >= nairaAmount);
    setWallet(affordable || eligibleWallets[0]);
  }, [eligibleWallets, nairaAmount, walletNaira]);

  // ─── Contacts ────────────────────────────────────────────
  const pickContact = async () => {
    if (Platform.OS === "web") return;
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Denied", "Please allow contact access in your device settings.");
      return;
    }
    setContactsLoading(true);
    setShowContactPicker(true);
    setContactSearch("");
    try {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
        sort: Contacts.SortTypes.FirstName,
      });
      const mapped: { name: string; phone: string }[] = [];
      for (const c of data) {
        for (const pn of c.phoneNumbers || []) {
          if (!pn.number) continue;
          const digits = pn.number.replace(/[^0-9]/g, "");
          const normalized =
            digits.startsWith("234") && digits.length >= 13 ? "0" + digits.slice(3) : digits;
          if (normalized.length >= 10) {
            mapped.push({ name: c.name || c.firstName || "Unknown", phone: normalized });
          }
        }
      }
      setContactList(mapped);
    } catch {
      Alert.alert("Error", "Could not load contacts.");
      setShowContactPicker(false);
    } finally {
      setContactsLoading(false);
    }
  };

  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return contactList;
    const q = contactSearch.toLowerCase();
    return contactList.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q),
    );
  }, [contactList, contactSearch]);

  // ─── Keyboard ────────────────────────────────────────────
  // The paying card and Continue ride up with the keypad, so the amount and
  // what it comes out of stay on screen together.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const show = Keyboard.addListener("keyboardWillShow", (e) => {
      Animated.timing(lift, {
        toValue: -Math.max(0, e.endCoordinates.height - bottomPad),
        duration: e.duration || 250,
        useNativeDriver: true,
      }).start();
    });
    const hide = Keyboard.addListener("keyboardWillHide", (e) => {
      Animated.timing(lift, { toValue: 0, duration: e.duration || 200, useNativeDriver: true }).start();
    });
    return () => { show.remove(); hide.remove(); };
  }, [bottomPad, lift]);

  /**
   * A Nigerian mobile number, or nothing.
   *
   * The old check was `length >= 10`, which let a half-typed number through to
   * the summary and on to a purchase that could only fail at the provider -
   * with the money already committed. Airtime goes to whatever number is sent
   * and cannot be recalled, so this is the last place it can be caught.
   *
   * Accepts the three ways people enter one: 08012345678, 8012345678, and
   * +2348012345678 pasted from a contact.
   */
  const phoneDigits = phone.replace(/\D/g, "");
  const localPhone =
    phoneDigits.length === 13 && phoneDigits.startsWith("234")
      ? "0" + phoneDigits.slice(3)
      : phoneDigits.length === 10 && phoneDigits[0] !== "0"
        ? "0" + phoneDigits
        : phoneDigits;
  // 0, then 7/8/9, then 0/1, then eight more: every Nigerian mobile range.
  const phoneValid = /^0[789][01]\d{8}$/.test(localPhone);

  // ─── Continue ────────────────────────────────────────────
  const ready =
    !!network && phoneValid && nairaAmount > 0 && nairaAmount <= PER_TX_LIMIT && !!wallet;

  const handleContinue = () => {
    let bad = false;
    if (!network) return setShowProviders(true);
    if (!phoneDigits) {
      setPhoneError("Enter the phone number");
      bad = true;
    } else if (!phoneValid) {
      setPhoneError("Invalid phone number");
      bad = true;
    } else setPhoneError("");

    if (isData && !selectedPlan) {
      setAmountError("Pick a data plan");
      bad = true;
    } else if (nairaAmount <= 0) {
      setAmountError("Enter an amount");
      bad = true;
    } else if (nairaAmount > PER_TX_LIMIT) {
      setAmountError(`Most you can send at once is ₦${PER_TX_LIMIT.toLocaleString()}`);
      bad = true;
    } else if (nairaAmount > DAILY_LIMIT) {
      setAmountError(`Daily limit is ₦${DAILY_LIMIT.toLocaleString()}`);
      bad = true;
    } else setAmountError("");

    if (bad || !wallet) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/airtime-summary",
      params: {
        // Normalised, so a number typed as 8012345678 or +2348012345678 is
        // bought for the same line as 08012345678.
        phone: localPhone,
        amount: String(nairaAmount),
        network: network.name,
        networkColor: network.color,
        type: tab,
        planLabel: selectedPlan?.label || "",
        variationId: selectedPlan?.variationId || "",
        // Chosen here now, so the confirm screen states a decision rather than
        // making one on the user's behalf at the last moment.
        asset: wallet.asset,
        chain: wallet.chain,
      },
    });
  };

  const providerLabel = (n: string) => `${isData ? "Data" : "Airtime"}-${n}`;
  const title = isData ? "Data" : "Airtime";

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[s.back, { backgroundColor: colors.muted }]}
          hitSlop={10}
        >
          <Feather name="chevron-left" size={21} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>{title}</Text>
      </View>
      <View style={[s.rule, { backgroundColor: colors.border }]} />

      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {storedRecent.length > 0 && (
          <>
            <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>RECENT</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              // A horizontal scroller nested in a vertical one stretches to
              // fill unless told not to. On Android that squeezes everything
              // below it, which is why this screen came out compressed.
              style={s.recentBar}
              contentContainerStyle={s.recentRow}
            >
              {storedRecent.slice(0, 8).map((r, i) => {
                const logo = PROVIDER_LOGOS[r.network?.toUpperCase()];
                return (
                  <TouchableOpacity
                    key={`${r.phone}-${i}`}
                    style={s.recent}
                    activeOpacity={0.75}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setPhone(r.phone);
                      setPhoneError("");
                      const n = NETWORKS.find((x) => x.name.toLowerCase() === r.network?.toLowerCase());
                      if (n) setNetwork(n);
                    }}
                  >
                    <View style={[s.recentDisc, { backgroundColor: colors.card }]}>
                      {logo ? (
                        <Image source={logo} style={s.recentLogo} resizeMode="contain" />
                      ) : (
                        <Text style={[s.recentInitials, { color: colors.primary }]}>
                          {(r.network || "?").slice(0, 3).toUpperCase()}
                        </Text>
                      )}
                    </View>
                    <Text style={[s.recentPhone, { color: colors.foreground }]} numberOfLines={1}>
                      {r.phone}
                    </Text>
                    <Text style={[s.recentNet, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {r.network}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </>
        )}

        {/* Provider, phone and amount as one stack of ruled rows. Cards around
            each would make three panels out of one short form.

            This first rule closes the recents strip, so with no recents to
            close it is a line hanging under the header. */}
        {storedRecent.length > 0 && (
          <View style={[s.rule, { backgroundColor: colors.border, marginTop: 20 }]} />
        )}

        <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={() => setShowProviders(true)}>
          <Text
            style={[
              s.rowValue,
              { color: network ? colors.foreground : colors.mutedForeground },
            ]}
          >
            {network ? providerLabel(network.name) : "Select provider"}
          </Text>
          <Feather name="chevron-down" size={19} color={colors.mutedForeground} />
        </TouchableOpacity>
        <View style={[s.rule, { backgroundColor: colors.border }]} />

        {!!network && (
          <>
            <View style={s.row}>
              <TextInput
                style={[s.rowInput, { color: colors.foreground }]}
                value={phone}
                onChangeText={(t) => {
                  setPhone(t.replace(/[^0-9]/g, "").slice(0, 11));
                  if (phoneError) setPhoneError("");
                }}
                placeholder="Phone Number"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="phone-pad"
              />
              <TouchableOpacity onPress={pickContact} hitSlop={10}>
                <Text style={[s.rowAction, { color: colors.primary }]}>Select contact</Text>
              </TouchableOpacity>
            </View>
            {!!phoneError && <Text style={s.err}>{phoneError}</Text>}
            <View style={[s.rule, { backgroundColor: colors.border }]} />

            {isData ? (
              <>
                <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={() => setShowPlans(true)}>
                  <Text
                    style={[
                      s.rowValue,
                      { color: selectedPlan ? colors.foreground : colors.mutedForeground },
                    ]}
                  >
                    {selectedPlan ? `${selectedPlan.label} · ₦${selectedPlan.price}` : "Select a plan"}
                  </Text>
                  <Feather name="chevron-down" size={19} color={colors.mutedForeground} />
                </TouchableOpacity>
              </>
            ) : (
              <View style={s.row}>
                <Image
                  source={require("@/assets/images/nairaiconnew.png")}
                  style={[
                    s.naira,
                    { tintColor: nairaAmount > 0 ? colors.foreground : colors.mutedForeground },
                  ]}
                />
                <TextInput
                  style={[s.rowInput, { color: colors.foreground, marginLeft: 8 }]}
                  value={customAmount}
                  onChangeText={(t) => {
                    const d = t.replace(/[^0-9]/g, "").slice(0, 7);
                    setCustomAmount(d ? Number(d).toLocaleString("en-NG") : "");
                    if (amountError) setAmountError("");
                  }}
                  placeholder="Amount"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="number-pad"
                />
              </View>
            )}
            {!!amountError && <Text style={s.err}>{amountError}</Text>}
            <View style={[s.rule, { backgroundColor: colors.border }]} />

            {!isData && (
              <View style={s.chips}>
                {AIRTIME_AMOUNTS.filter((a) => Number(a.replace(/,/g, "")) <= PER_TX_LIMIT).map((a) => {
                  const on = customAmount === a;
                  return (
                    <TouchableOpacity
                      key={a}
                      style={[s.chip, { backgroundColor: on ? colors.primary : colors.card }]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setCustomAmount(a);
                        setAmountError("");
                      }}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          s.chipText,
                          { color: on ? colors.primaryForeground : colors.mutedForeground },
                        ]}
                      >
                        ₦{a}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            <Text style={[s.limit, { color: colors.mutedForeground }]}>
              Up to ₦{PER_TX_LIMIT.toLocaleString()} per purchase, ₦{DAILY_LIMIT.toLocaleString()} a day.
              {!verified && (
                <Text style={{ color: colors.primary }} onPress={() => router.push("/account/limits" as any)}>
                  {" "}Verify your ID for more.
                </Text>
              )}
            </Text>
          </>
        )}
      </ScrollView>

      {/* What it comes out of, and the way out of it. */}
      <Animated.View
        style={[
          s.footer,
          { paddingBottom: bottomPad + 14, backgroundColor: colors.background, transform: [{ translateY: lift }] },
        ]}
      >
        <TouchableOpacity
          style={[s.payCard, { backgroundColor: colors.card }]}
          activeOpacity={0.8}
          onPress={() => setShowWallets(true)}
        >
          {wallet ? (
            <>
              <TokenLogo symbol={wallet.asset} size={38} />
              <View style={{ flex: 1 }}>
                <Text style={[s.payLabel, { color: colors.mutedForeground }]}>
                  {assetLabel(wallet.asset)} on {CHAIN_NAMES[wallet.chain] || wallet.chain}
                </Text>
                <Text style={[s.payValue, { color: colors.foreground }]}>
                  {fmtNaira(walletNaira(wallet))}
                </Text>
              </View>
              <Text style={[s.change, { color: colors.primary }]}>Change</Text>
            </>
          ) : (
            <>
              <View style={[s.payEmpty, { backgroundColor: colors.muted }]}>
                <Feather name="alert-circle" size={18} color={colors.mutedForeground} />
              </View>
              <Text style={[s.payLabel, { flex: 1, color: colors.mutedForeground }]}>
                No balance to pay with
              </Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.cta, { backgroundColor: ready ? colors.primary : colors.muted }]}
          onPress={handleContinue}
          disabled={!ready}
          activeOpacity={0.85}
        >
          <Text style={[s.ctaText, { color: ready ? colors.primaryForeground : colors.mutedForeground }]}>
            Continue
          </Text>
        </TouchableOpacity>
      </Animated.View>

      {/* ─── Provider picker ─── */}
      <Modal visible={showProviders} animationType="slide" onRequestClose={() => setShowProviders(false)}>
        <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
          <View style={s.header}>
            <TouchableOpacity
              onPress={() => setShowProviders(false)}
              style={[s.back, { backgroundColor: colors.muted }]}
              hitSlop={10}
            >
              <Feather name="chevron-left" size={21} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[s.title, { color: colors.foreground }]}>Select a provider</Text>
          </View>
          <View style={[s.rule, { backgroundColor: colors.border }]} />
          <ScrollView contentContainerStyle={{ paddingBottom: bottomPad + 20 }}>
            {NETWORKS.map((n) => {
              const logo = PROVIDER_LOGOS[n.name.toUpperCase()];
              return (
                <TouchableOpacity
                  key={n.name}
                  style={s.providerRow}
                  activeOpacity={0.7}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setNetwork(n);
                    setSelectedPlan(null);
                    setShowProviders(false);
                  }}
                >
                  <View style={[s.providerDisc, { backgroundColor: colors.card }]}>
                    {logo ? (
                      <Image source={logo} style={s.providerLogo} resizeMode="contain" />
                    ) : (
                      <Text style={[s.recentInitials, { color: colors.primary }]}>{n.abbr}</Text>
                    )}
                  </View>
                  <Text style={[s.providerName, { color: colors.foreground }]}>
                    {providerLabel(n.name)}
                  </Text>
                  <Feather name="chevron-right" size={19} color={colors.mutedForeground} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* ─── Wallet picker ─── */}
      <Modal visible={showWallets} transparent animationType="fade" onRequestClose={() => setShowWallets(false)}>
        <TouchableOpacity
          style={s.sheetOverlay}
          activeOpacity={1}
          onPress={() => setShowWallets(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[s.sheet, { backgroundColor: colors.card, paddingBottom: bottomPad + 16 }]}
          >
            <View style={[s.grip, { backgroundColor: colors.border }]} />
            <Text style={[s.sheetTitle, { color: colors.foreground }]}>Pay with</Text>
            {eligibleWallets.length === 0 ? (
              <Text style={[s.sheetSub, { color: colors.mutedForeground, marginTop: 20 }]}>
                Nothing to pay with yet. Deposit or buy crypto first.
              </Text>
            ) : (
              eligibleWallets.map((w) => {
                const on = wallet?.asset === w.asset && wallet?.chain === w.chain;
                const enough = walletNaira(w) >= nairaAmount;
                return (
                  <TouchableOpacity
                    key={`${w.asset}-${w.chain}`}
                    style={[s.walletRow, { backgroundColor: on ? colors.primary + "14" : "transparent" }]}
                    activeOpacity={0.75}
                    onPress={() => {
                      Haptics.selectionAsync();
                      touchedWallet.current = true;
                      setWallet(w);
                      setShowWallets(false);
                    }}
                  >
                    <TokenLogo symbol={w.asset} size={36} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.walletName, { color: colors.foreground }]}>
                        {assetLabel(w.asset)} on {CHAIN_NAMES[w.chain] || w.chain}
                      </Text>
                      <Text style={[s.walletSub, { color: colors.mutedForeground }]}>
                        {Number(w.balance.toFixed(4))} {assetLabel(w.asset)} · {fmtNaira(walletNaira(w))}
                      </Text>
                    </View>
                    {/* Says why a wallet will not work before it is chosen,
                        rather than failing at the confirm step. */}
                    {!enough && nairaAmount > 0 ? (
                      <Text style={[s.walletShort, { color: colors.mutedForeground }]}>Low</Text>
                    ) : on ? (
                      <Ionicons name="checkmark-circle-outline" size={22} color={colors.primary} />
                    ) : null}
                  </TouchableOpacity>
                );
              })
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ─── Data plans ─── */}
      <Modal visible={showPlans} animationType="slide" onRequestClose={() => setShowPlans(false)}>
        <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
          <View style={s.header}>
            <TouchableOpacity
              onPress={() => setShowPlans(false)}
              style={[s.back, { backgroundColor: colors.muted }]}
              hitSlop={10}
            >
              <Feather name="chevron-left" size={21} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[s.title, { color: colors.foreground }]}>Select a plan</Text>
          </View>
          <View style={[s.rule, { backgroundColor: colors.border }]} />

          {!liveDataPlans && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              // flexGrow:0, or the row stretches down the screen and takes the
              // chips with it - which is why these were tall slabs.
              style={s.catBar}
              contentContainerStyle={s.catRow}
            >
              {DATA_CATEGORIES.map((c) => {
                const on = dataCategory === c.key;
                return (
                  <TouchableOpacity
                    key={c.key}
                    style={[s.chip, { backgroundColor: on ? colors.primary : colors.card }]}
                    onPress={() => setDataCategory(c.key)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[s.chipText, { color: on ? colors.primaryForeground : colors.mutedForeground }]}
                    >
                      {c.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {plansLoading ? (
            <View style={s.loading}>
              <ActivityIndicator color={colors.mutedForeground} />
            </View>
          ) : (
            <FlatList
              data={plans}
              keyExtractor={(p, i) => `${p.variationId || p.label}-${i}`}
              contentContainerStyle={{ paddingBottom: bottomPad + 20 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.providerRow}
                  activeOpacity={0.7}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSelectedPlan(item);
                    setAmountError("");
                    setShowPlans(false);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.providerName, { color: colors.foreground }]}>{item.label}</Text>
                    {!!item.validity && (
                      <Text style={[s.walletSub, { color: colors.mutedForeground }]}>{item.validity}</Text>
                    )}
                  </View>
                  <Text style={[s.planPrice, { color: colors.foreground }]}>
                    {fmtNaira(Number(item.price))}
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>

      {/* ─── Contacts ─── */}
      <Modal visible={showContactPicker} animationType="slide" onRequestClose={() => setShowContactPicker(false)}>
        <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
          <View style={s.header}>
            <TouchableOpacity
              onPress={() => setShowContactPicker(false)}
              style={[s.back, { backgroundColor: colors.muted }]}
              hitSlop={10}
            >
              <Feather name="chevron-left" size={21} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[s.title, { color: colors.foreground }]}>Select a contact</Text>
          </View>
          <View style={[s.rule, { backgroundColor: colors.border }]} />

          <View style={[s.search, { backgroundColor: colors.card }]}>
            <Feather name="search" size={17} color={colors.mutedForeground} />
            <TextInput
              style={[s.searchInput, { color: colors.foreground }]}
              value={contactSearch}
              onChangeText={setContactSearch}
              placeholder="Search contacts"
              placeholderTextColor={colors.mutedForeground}
            />
          </View>

          {contactsLoading ? (
            <View style={s.loading}>
              <ActivityIndicator color={colors.mutedForeground} />
            </View>
          ) : (
            <FlatList
              data={filteredContacts}
              keyExtractor={(c, i) => `${c.phone}-${i}`}
              contentContainerStyle={{ paddingBottom: bottomPad + 20 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.providerRow}
                  activeOpacity={0.7}
                  onPress={() => {
                    setPhone(item.phone);
                    setPhoneError("");
                    setShowContactPicker(false);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.providerName, { color: colors.foreground }]}>{item.name}</Text>
                    <Text style={[s.walletSub, { color: colors.mutedForeground }]}>{item.phone}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingBottom: 14, paddingTop: 4 },
  back: { position: "absolute", left: 20, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, lineHeight: 22, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: 20 },

  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28 },
  sectionLabel: { fontSize: 10.5, lineHeight: 14, fontFamily: "Inter_600SemiBold", letterSpacing: 1.4, marginBottom: 12 },

  recentBar: { flexGrow: 0 },
  recentRow: { gap: 18, paddingRight: 20, alignItems: "flex-start" },
  recent: { width: 72, alignItems: "center" },
  recentDisc: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  recentLogo: { width: 34, height: 34 },
  recentInitials: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  recentPhone: { fontSize: 10.5, lineHeight: 14, fontFamily: "Inter_500Medium", marginTop: 7 },
  recentNet: { fontSize: 10.5, lineHeight: 14, fontFamily: "Inter_400Regular" },

  // Rows are the form. A rule between each, nothing around them.
  row: { flexDirection: "row", alignItems: "center", minHeight: 58, gap: 10 },
  rowValue: { flex: 1, fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  rowInput: { flex: 1, fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold", padding: 0 },
  rowAction: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  naira: { width: 17 * FONT_SCALE, height: 17 * FONT_SCALE, resizeMode: "contain" },
  err: { color: "#ef4444", fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginBottom: 8 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  chipText: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  catBar: { flexGrow: 0 },
  catRow: { gap: 8, paddingHorizontal: 20, paddingVertical: 14, alignItems: "center" },

  limit: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 18 },

  footer: { paddingHorizontal: 20, paddingTop: 12 },
  payCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, marginBottom: 12 },
  payEmpty: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  payLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular" },
  payValue: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3, marginTop: 1 },
  change: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_700Bold" },

  cta: { height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  ctaText: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },

  providerRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 14 },
  providerDisc: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  providerLogo: { width: 30, height: 30 },
  providerName: { flex: 1, fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  planPrice: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_800ExtraBold" },

  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 10 },
  grip: { width: 38, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 18 },
  sheetTitle: { fontSize: 20, lineHeight: 26, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.5, paddingHorizontal: 4, marginBottom: 14 },
  sheetSub: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", paddingHorizontal: 4, marginTop: 3, marginBottom: 14 },
  walletRow: { flexDirection: "row", alignItems: "center", gap: 13, padding: 12, borderRadius: 16 },
  walletName: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  walletSub: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 2 },
  walletShort: { fontSize: 11.5, lineHeight: 16, fontFamily: "Inter_600SemiBold" },

  search: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 20, marginTop: 14, paddingHorizontal: 14, height: 46, borderRadius: 14 },
  searchInput: { flex: 1, fontSize: 14.5, fontFamily: "Inter_400Regular", padding: 0 },
  loading: { paddingVertical: 50, alignItems: "center" },
});
