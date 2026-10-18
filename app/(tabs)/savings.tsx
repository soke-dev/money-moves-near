import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Platform,
  Image,
  Alert,
  ActivityIndicator,
  Keyboard,
  Share,
  KeyboardAvoidingView,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import ViewShot from "react-native-view-shot";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { TokenLogo } from "@/components/TokenLogo";

type Duration = "2m" | "7d" | "30d" | "3m" | "6m" | "custom";
type Asset = "USDC" | "USDT";

interface NetworkInfo { name: string; tag: string; }

const CHAIN_LOGOS: Record<string, any> = {
  MOVE: require("@/assets/images/movementnew.jpg"),
  BASE: require("@/assets/images/base logo.png"),
  SOL: require("@/assets/images/solana.png"),
  BEP20: require("@/assets/images/bsc logo.png"),
};

const SUPPORTED_CHAINS: NetworkInfo[] = [
  { name: "Movement", tag: "MOVE" },
];

const td = (asset: string) => asset === "ETH" ? 8 : asset === "MOVE" ? 2 : 4;

const ASSET_CHAINS: Record<Asset, NetworkInfo[]> = {
  USDC: SUPPORTED_CHAINS,
  USDT: SUPPORTED_CHAINS,
};

const DURATIONS: { key: Duration; label: string; days: number }[] = [
  { key: "7d",  label: "7 Days",   days: 7   },
  { key: "30d", label: "30 Days",  days: 30  },
  { key: "3m",  label: "3 Months", days: 90  },
  { key: "6m",  label: "6 Months", days: 180 },
  { key: "custom", label: "Custom", days: 0 },
];

const LOCK_FEE = 0.005;

function parseDate(dateStr: string): number {
  const ts = new Date(dateStr).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

function daysProgress(startDate: string, endDate: string): number {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end || end <= start) return 0;
  const now = Date.now();
  if (now >= end) return 1;
  if (now <= start) return 0;
  return (now - start) / (end - start);
}

function daysRemaining(endDate: string): number {
  const end = parseDate(endDate);
  if (!end) return 0;
  const diff = end - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function remainingLabel(endDate: string): string {
  const end = parseDate(endDate);
  if (!end) return "0 days";
  const diff = end - Date.now();
  if (diff <= 0) return "Ready";
  const mins = Math.ceil(diff / (1000 * 60));
  if (mins < 60) return `${mins} min${mins !== 1 ? "s" : ""} remaining`;
  const hours = Math.ceil(diff / (1000 * 60 * 60));
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} remaining`;
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return `${days} day${days !== 1 ? "s" : ""} remaining`;
}

function isUnlocked(endDate: string): boolean {
  const end = parseDate(endDate);
  if (!end) return false;
  return Date.now() >= end;
}

export default function SavingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { savings, walletBalances, addSavings, withdrawSavings, addToLock, walletReady, verifyPin, rates } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [showModal, setShowModal] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset>("USDC");
  const [selectedChain, setSelectedChain] = useState<NetworkInfo>(ASSET_CHAINS.USDC[0]);
  const [chainDropdownOpen, setChainDropdownOpen] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState<Duration>("30d");
  const [customUnlockDate, setCustomUnlockDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [lockName, setLockName] = useState("");
  const [lockSuccess, setLockSuccess] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // PIN verification
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState(["", "", "", ""]);
  const [pinError, setPinError] = useState(false);
  const pinRefs = useRef<(TextInput | null)[]>([]);
  const pendingAction = useRef<() => void>(() => {});
  const flexShotRef = useRef<any>(null);

  // Lock result for success screen
  const [lockResult, setLockResult] = useState<{ amount: number; fee: number; txHash: string } | null>(null);

  // Detail modal
  const [detailPlan, setDetailPlan] = useState<typeof savings[0] | null>(null);
  const [withdrawError, setWithdrawError] = useState("");
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);

  // Add-to-lock state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addAmount, setAddAmount] = useState("");
  const [addAmountError, setAddAmountError] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [showAddPin, setShowAddPin] = useState(false);
  const [addPin, setAddPin] = useState(["", "", "", ""]);
  const [addPinError, setAddPinError] = useState(false);
  const addPinRefs = useRef<(TextInput | null)[]>([]);
  const [addResult, setAddResult] = useState<{ amount: number; fee: number; txHash: string } | null>(null);

  // Flex receipt
  const [showFlex, setShowFlex] = useState(false);

  // Expand states for lists
  const [showAllActive, setShowAllActive] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);

  const handleAssetChange = (a: Asset) => {
    setSelectedAsset(a);
    setSelectedChain(ASSET_CHAINS[a][0]);
    setChainDropdownOpen(false);
  };

  const activeSavings = savings.filter((s) => s.status === "ACTIVE");
  const completedSavings = savings.filter((s) => s.status !== "ACTIVE");

  // Total locked amounts by asset (from completed/withdrawn history)
  const historyTotalUsdc = completedSavings.filter((s) => s.asset === "USDC").reduce((sum, s) => sum + s.amount, 0);
  const historyTotalUsdt = completedSavings.filter((s) => s.asset === "USDT").reduce((sum, s) => sum + s.amount, 0);

  /** Human-readable duration from durationDays stored in DB */
  const getDurationLabel = (days: number): string => {
    const STANDARD = DURATIONS.filter((d) => d.key !== "custom" && d.key !== "2m");
    const match = STANDARD.find((d) => Math.abs(d.days - days) < 1);
    if (match) return match.label;
    if (days < 1) return `${Math.round(days * 24 * 60)} Min (Test)`;
    return `${Math.round(days)} Days`;
  };

  const totalLockedUSD = savings
    .filter((s) => s.status === "ACTIVE")
    .reduce((sum, s) => sum + s.amount, 0);

  const getEndDate = (duration: Duration): string => {
    if (duration === "custom" && customUnlockDate) {
      return customUnlockDate.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
    }
    const now = new Date();
    const d = DURATIONS.find((x) => x.key === duration)!;
    if (duration === "2m") now.setTime(now.getTime() + 2 * 60 * 1000);
    else if (duration === "7d" || duration === "30d") now.setDate(now.getDate() + d.days);
    else if (duration === "3m") now.setMonth(now.getMonth() + 3);
    else if (duration === "6m") now.setMonth(now.getMonth() + 6);
    return now.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  };

  const handleLockPress = () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setAmountError("Enter a valid amount"); return; }
    if (amt < 1) { setAmountError("Minimum deposit is $1"); return; }
    if (selectedDuration === "custom" && !customUnlockDate) { setAmountError("Select an unlock date"); return; }
    if (selectedDuration === "custom" && customUnlockDate && customUnlockDate.getTime() <= Date.now()) { setAmountError("Unlock date must be in the future"); return; }
    const fee = amt * LOCK_FEE;
    const total = amt + fee;
    if (total > chainBalance) {
      setAmountError(`Need ${total.toFixed(td(selectedAsset))} ${selectedAsset} (incl. 0.5% fee). You have ${chainBalance.toFixed(td(selectedAsset))} on ${selectedChain.name}`);
      return;
    }
    setAmountError("");
    setShowConfirm(true);
  };

  const requestPin = (action: () => void) => {
    pendingAction.current = action;
    setPin(["", "", "", ""]);
    setPinError(false);
    setShowPin(true);
    setTimeout(() => pinRefs.current[0]?.focus(), 300);
  };

  const handlePinInput = (value: string, index: number) => {
    setPinError(false);
    const newPin = [...pin];
    newPin[index] = value;
    setPin(newPin);
    if (value && index < 3) pinRefs.current[index + 1]?.focus();
    if (index === 3 && value) {
      const fullPin = newPin.join("");
      (async () => {
        try {
          const valid = await verifyPin(fullPin);
          if (valid) {
            Keyboard.dismiss();
            setShowPin(false);
            pendingAction.current();
          } else {
            setPinError(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            setTimeout(() => { setPin(["", "", "", ""]); pinRefs.current[0]?.focus(); }, 600);
          }
        } catch (e: any) {
          if (e?.message === "WRONG_PIN") {
            setPinError(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            setTimeout(() => { setPin(["", "", "", ""]); pinRefs.current[0]?.focus(); }, 600);
          } else if (e?.message === "PIN_LOCKED") {
            Alert.alert("PIN Locked", e.errorMessage || "Too many attempts. Try again later.");
            setShowPin(false);
            setPin(["", "", "", ""]);
          } else {
            Alert.alert("Error", "Something went wrong. Please try again.");
            setPin(["", "", "", ""]);
            setTimeout(() => pinRefs.current[0]?.focus(), 300);
          }
        }
      })();
    }
  };

  const confirmLock = async () => {
    const amt = Number(amount);
    const durationData = DURATIONS.find((d) => d.key === selectedDuration)!;
    let durationDays: number;
    if (selectedDuration === "custom" && customUnlockDate) {
      durationDays = Math.max(0.001, (customUnlockDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    } else {
      durationDays = durationData.days;
    }
    setSubmitting(true);
    try {
      const result = await addSavings({
        asset: selectedAsset,
        chain: selectedChain!.tag,
        amount: amt,
        durationDays,
        ...(lockName.trim() && { name: lockName.trim() }),
      });
      setLockResult(result);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAmount("");
      setAmountError("");
      setLockName("");
      setCustomUnlockDate(null);
      setShowDatePicker(false);
      setShowConfirm(false);
      setShowPin(false);
      setLockSuccess(true);
    } catch (e: any) {
      setAmountError(e?.response?.data?.error || e?.message || "Lock failed. Please try again.");
      setShowConfirm(false);
      setShowPin(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdrawFromDetail = async () => {
    if (!detailPlan) return;
    if (detailPlan.status !== "ACTIVE") {
      setWithdrawError("This lock has already been withdrawn.");
      return;
    }
    if (!isUnlocked(detailPlan.endDate)) {
      setWithdrawError(`Locked until ${new Date(detailPlan.endDate).toLocaleDateString()}. You cannot withdraw before the unlock date.`);
      return;
    }
    setSubmitting(true);
    try {
      await withdrawSavings(detailPlan.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setWithdrawSuccess(true);
      setWithdrawError("");
    } catch (e: any) {
      setWithdrawError(e?.response?.data?.error || e?.message || "Withdraw failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddPress = () => {
    const amt = Number(addAmount);
    if (!amt || amt <= 0) { setAddAmountError("Enter a valid amount"); return; }
    if (amt < 1) { setAddAmountError("Minimum amount is $1"); return; }
    if (!detailPlan) return;
    const bal = walletBalances.find(b => b.asset === detailPlan.asset && b.chain === (detailPlan.chain || "MOVE"))?.balance ?? 0;
    const fee = amt * LOCK_FEE;
    const total = amt + fee;
    if (total > bal) {
      setAddAmountError(`Need ${total.toFixed(td(detailPlan.asset))} ${detailPlan.asset} (incl. 0.5% fee). Available: ${bal.toFixed(td(detailPlan.asset))}`);
      return;
    }
    setAddAmountError("");
    setShowAddPin(true);
    setAddPin(["", "", "", ""]);
    setAddPinError(false);
    setTimeout(() => addPinRefs.current[0]?.focus(), 300);
  };

  const handleAddPinInput = (value: string, index: number) => {
    setAddPinError(false);
    const newPin = [...addPin];
    newPin[index] = value;
    setAddPin(newPin);
    if (value && index < 3) addPinRefs.current[index + 1]?.focus();
    if (index === 3 && value) {
      const fullPin = newPin.join("");
      (async () => {
        try {
          const valid = await verifyPin(fullPin);
          if (valid) {
            Keyboard.dismiss();
            setShowAddPin(false);
            confirmAddToLock();
          } else {
            setAddPinError(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            setTimeout(() => { setAddPin(["", "", "", ""]); addPinRefs.current[0]?.focus(); }, 600);
          }
        } catch (e: any) {
          if (e?.message === "WRONG_PIN") {
            setAddPinError(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            setTimeout(() => { setAddPin(["", "", "", ""]); addPinRefs.current[0]?.focus(); }, 600);
          } else if (e?.message === "PIN_LOCKED") {
            Alert.alert("PIN Locked", e.errorMessage || "Too many attempts. Try again later.");
            setShowAddPin(false);
            setAddPin(["", "", "", ""]);
          } else {
            // Network or other error — don't show "incorrect PIN"
            Alert.alert("Error", "Something went wrong. Please try again.");
            setAddPin(["", "", "", ""]);
            setTimeout(() => addPinRefs.current[0]?.focus(), 300);
          }
        }
      })();
    }
  };

  const confirmAddToLock = async () => {
    if (!detailPlan) return;
    const amt = Number(addAmount);
    setAddSubmitting(true);
    try {
      const result = await addToLock(detailPlan.id, amt);
      setAddResult(result);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAddAmount("");
      setAddAmountError("");
      setShowAddForm(false);
      setShowAddPin(false);
    } catch (e: any) {
      setAddAmountError(e?.response?.data?.error || e?.message || "Add to lock failed. Please try again.");
      setShowAddPin(false);
    } finally {
      setAddSubmitting(false);
    }
  };

  const closeDetailModal = () => {
    setDetailPlan(null);
    setWithdrawError("");
    setShowAddForm(false);
    setAddAmount("");
    setAddAmountError("");
    setShowAddPin(false);
    setAddSubmitting(false);
    setAddResult(null);
    setShowFlex(false);
    setWithdrawSuccess(false);
  };

  const closeNewLockModal = () => {
    setShowModal(false);
    setLockSuccess(false);
    setShowConfirm(false);
    setShowPin(false);
    setSubmitting(false);
    setAmount("");
    setAmountError("");
    setLockName("");
    setCustomUnlockDate(null);
    setShowDatePicker(false);
    setChainDropdownOpen(false);
    setLockResult(null);
  };

  const selectedDurationData = DURATIONS.find((d) => d.key === selectedDuration)!;
  const customDurationLabel = selectedDuration === "custom" && customUnlockDate
    ? `${Math.ceil((customUnlockDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))} Days`
    : "Custom";
  const numAmount = Number(amount) || 0;
  const lockFeeAmount = numAmount * LOCK_FEE;

  const chainBalance = walletBalances.find(
    (b) => b.asset === selectedAsset && b.chain === selectedChain.tag
  )?.balance ?? 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 124 }} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={[styles.header, { paddingTop: topPad + 16 }]}>
          <View>
            <Text style={[styles.pageTitle, { color: colors.foreground }]}>Savings</Text>
            <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>On-chain locks</Text>
          </View>
          <TouchableOpacity
            style={[styles.newBtn, { backgroundColor: colors.primary }]}
            onPress={() => {
              if (!walletReady) {
                Alert.alert("Wallet Required", "Create your wallet first to start saving. Your wallet is non-custodial — only you control your keys.");
                return;
              }
              setLockSuccess(false); setShowModal(true);
            }}
          >
            <Feather name="plus" size={18} color={colors.primaryForeground} />
          </TouchableOpacity>
        </View>

        {/* Summary hero */}
        <View style={[styles.heroCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>Active Locks</Text>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={[styles.heroAmount, { color: colors.foreground, marginBottom: 0 }]}>
              ${totalLockedUSD.toFixed(2)}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {(["USDC", "USDT"] as Asset[]).map((a) => {
                const locked = savings.filter((s) => s.asset === a && s.status === "ACTIVE").reduce((sum, s) => sum + s.amount, 0);
                if (locked <= 0) return null;
                return (
                  <View key={a} style={[styles.heroChip, { backgroundColor: colors.background }]}>
                    <TokenLogo symbol={a} size={14} />
                    <Text style={[styles.heroChipText, { color: colors.foreground }]}>{locked.toFixed(2)}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>

        {/* Active Locks */}
        {activeSavings.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Active Locks</Text>
              <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>{activeSavings.length}</Text>
            </View>
            {(showAllActive ? activeSavings : activeSavings.slice(0, 10)).map((plan) => {
              const durLabel = getDurationLabel(plan.durationDays);
              const progress = Math.min(1, Math.max(0, daysProgress(plan.startDate, plan.endDate)));
              const remaining = remainingLabel(plan.endDate);
              const unlocked = isUnlocked(plan.endDate);
              return (
                <TouchableOpacity
                  key={plan.id}
                  style={[styles.lockCard, { backgroundColor: colors.card }]}
                  onPress={() => { setWithdrawError(""); setShowAddForm(false); setAddResult(null); setShowFlex(false); setDetailPlan(plan); }}
                  activeOpacity={0.7}
                >
                  {/* Top row: icon + info + status */}
                  <View style={styles.lockCardTop}>
                    <View style={[styles.lockCardIcon, { backgroundColor: unlocked ? "#22c55e18" : colors.primary + "14" }]}>
                      <Feather name={unlocked ? "unlock" : "lock"} size={18} color={unlocked ? "#22c55e" : colors.primary} />
                    </View>
                    <View style={styles.lockCardInfo}>
                      {plan.name ? (
                        <Text style={[styles.lockCardName, { color: colors.mutedForeground }]} numberOfLines={1}>{plan.name}</Text>
                      ) : null}
                      <Text style={[styles.lockCardAmount, { color: colors.foreground }]}>
                        {plan.amount.toFixed(td(plan.asset))} {plan.asset}
                      </Text>
                    </View>
                    {unlocked ? (
                      <View style={[styles.lockCardBadge, { backgroundColor: "#22c55e18" }]}>
                        <Text style={[styles.lockCardBadgeText, { color: "#22c55e" }]}>Ready</Text>
                      </View>
                    ) : (
                      <Text style={[styles.lockCardPct, { color: colors.primary }]}>{Math.round(progress * 100)}%</Text>
                    )}
                  </View>

                  {/* Progress bar */}
                  <View style={[styles.lockCardTrack, { backgroundColor: colors.muted }]}>
                    <View style={[styles.lockCardFill, { width: `${Math.round(progress * 100)}%` as any, backgroundColor: unlocked ? "#22c55e" : colors.primary }]} />
                  </View>

                  {/* Bottom row: duration + chain */}
                  <View style={styles.lockCardBottom}>
                    <View style={styles.lockCardMeta}>
                      <Text style={[styles.lockCardMetaText, { color: colors.mutedForeground }]}>{durLabel}</Text>
                      {CHAIN_LOGOS[plan.chain] ? (
                        <Image source={CHAIN_LOGOS[plan.chain]} style={{ width: 12, height: 12, borderRadius: 6 }} />
                      ) : null}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
            {activeSavings.length > 10 && !showAllActive && (
              <TouchableOpacity style={[styles.viewMoreBtn, { backgroundColor: colors.card }]} activeOpacity={0.7} onPress={() => setShowAllActive(true)}>
                <Text style={[styles.viewMoreText, { color: colors.primary }]}>View {activeSavings.length - 10} more</Text>
                <Feather name="chevron-down" size={16} color={colors.primary} />
              </TouchableOpacity>
            )}
            {showAllActive && (
              <TouchableOpacity style={[styles.viewMoreBtn, { backgroundColor: colors.card }]} activeOpacity={0.7} onPress={() => setShowAllActive(false)}>
                <Text style={[styles.viewMoreText, { color: colors.primary }]}>Show less</Text>
                <Feather name="chevron-up" size={16} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Past Locks */}
        {completedSavings.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>History</Text>
              <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>{completedSavings.length} locks</Text>
            </View>

            {/* Total Locked Summary Card */}
            <View style={[styles.historyTotalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Feather name="lock" size={14} color={colors.mutedForeground} />
                  <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5 }}>Total Locked</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  {historyTotalUsdc > 0 && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <TokenLogo symbol="USDC" size={20} />
                      <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground }}>{historyTotalUsdc.toFixed(2)}</Text>
                    </View>
                  )}
                  {historyTotalUsdc > 0 && historyTotalUsdt > 0 && (
                    <View style={{ width: 1, height: 18, backgroundColor: colors.border }} />
                  )}
                  {historyTotalUsdt > 0 && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <TokenLogo symbol="USDT" size={20} />
                      <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground }}>{historyTotalUsdt.toFixed(2)}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>

            {(showAllHistory ? completedSavings : completedSavings.slice(0, 5)).map((plan) => {
              const durLabel = getDurationLabel(plan.durationDays);
              return (
                <TouchableOpacity
                  key={plan.id}
                  style={[styles.historyCard, { backgroundColor: colors.card }]}
                  onPress={() => { setWithdrawError(""); setShowAddForm(false); setAddResult(null); setShowFlex(false); setDetailPlan(plan); }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.historyIcon, { backgroundColor: plan.status === "WITHDRAWN" ? "#22c55e14" : "#f59e0b14" }]}>
                    <Feather name={plan.status === "WITHDRAWN" ? "unlock" : "lock"} size={16} color={plan.status === "WITHDRAWN" ? "#22c55e" : "#f59e0b"} />
                  </View>
                  <View style={{ flex: 1 }}>
                    {plan.name ? (
                      <Text style={[styles.historyName, { color: colors.mutedForeground }]} numberOfLines={1}>{plan.name}</Text>
                    ) : null}
                    <Text style={[styles.historyAmount, { color: colors.foreground }]}>
                      {plan.amount.toFixed(td(plan.asset))} {plan.asset}
                    </Text>
                    <Text style={[styles.historyMeta, { color: colors.mutedForeground }]}>
                      {durLabel} · {new Date(plan.startDate).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}
                    </Text>
                  </View>
                  <View style={[styles.historyStatusBadge, { backgroundColor: plan.status === "WITHDRAWN" ? colors.mutedForeground + "14" : "#22c55e14" }]}>
                    <Text style={[styles.historyStatusText, { color: plan.status === "WITHDRAWN" ? colors.mutedForeground : "#22c55e" }]}>
                      {plan.status === "WITHDRAWN" ? "Withdrawn" : "Completed"}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            {completedSavings.length > 5 && !showAllHistory && (
              <TouchableOpacity style={[styles.viewMoreBtn, { backgroundColor: colors.card }]} activeOpacity={0.7} onPress={() => setShowAllHistory(true)}>
                <Text style={[styles.viewMoreText, { color: colors.primary }]}>View {completedSavings.length - 5} more</Text>
                <Feather name="chevron-down" size={16} color={colors.primary} />
              </TouchableOpacity>
            )}
            {showAllHistory && (
              <TouchableOpacity style={[styles.viewMoreBtn, { backgroundColor: colors.card }]} activeOpacity={0.7} onPress={() => setShowAllHistory(false)}>
                <Text style={[styles.viewMoreText, { color: colors.primary }]}>Show less</Text>
                <Feather name="chevron-up" size={16} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Empty state */}
        {savings.length === 0 && (
          <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.primary + "12" }]}>
              <Feather name="shield" size={32} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Start Saving</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Lock your stablecoins on-chain for a fixed period. Secure, transparent, and non-custodial.
            </Text>
            <TouchableOpacity
              style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                if (!walletReady) {
                  Alert.alert("Wallet Required", "Create your wallet first to start saving. Your wallet is non-custodial — only you control your keys.");
                  return;
                }
                setShowModal(true);
              }}
            >
              <Text style={[styles.emptyBtnText, { color: colors.primaryForeground }]}>Create Lock</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* New Lock Modal */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!submitting) closeNewLockModal(); }}>
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>New Lock</Text>
            <TouchableOpacity onPress={closeNewLockModal} disabled={submitting}>
              <Feather name="x" size={22} color={submitting ? colors.border : colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {lockSuccess ? (
            <View style={styles.successView}>
              <View style={[styles.successCircle, { backgroundColor: colors.primary + "18" }]}>

                <Feather name="check" size={36} color={colors.primary} />
              </View>
              <Text style={[styles.successTitle, { color: colors.foreground }]}>Lock Created!</Text>
              <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
                Your tokens have been locked on-chain. A 0.5% lock fee was applied.
              </Text>

              <View style={[styles.successDetails, { backgroundColor: colors.card }]}>
                <View style={styles.successRow}>
                  <Text style={[styles.successRowLabel, { color: colors.mutedForeground }]}>Asset</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <TokenLogo symbol={selectedAsset} size={18} />
                    <Text style={[styles.successRowVal, { color: colors.foreground }]}>{selectedAsset}</Text>
                  </View>
                </View>
                <View style={styles.successRow}>
                  <Text style={[styles.successRowLabel, { color: colors.mutedForeground }]}>Chain</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    {selectedChain && CHAIN_LOGOS[selectedChain.tag] && (
                      <Image source={CHAIN_LOGOS[selectedChain.tag]} style={styles.chainLogo} />
                    )}
                    <Text style={[styles.successRowVal, { color: colors.foreground }]}>{selectedChain.name}</Text>
                  </View>
                </View>
                {lockResult && (
                  <>
                    <View style={styles.successRow}>
                      <Text style={[styles.successRowLabel, { color: colors.mutedForeground }]}>Amount Locked</Text>
                      <Text style={[styles.successRowVal, { color: colors.foreground }]}>{lockResult.amount.toFixed(td(selectedAsset))} {selectedAsset}</Text>
                    </View>
                    <View style={styles.successRow}>
                      <Text style={[styles.successRowLabel, { color: colors.mutedForeground }]}>Lock Fee (0.5%)</Text>
                      <Text style={[styles.successRowVal, { color: colors.foreground }]}>{lockResult.fee.toFixed(td(selectedAsset))} {selectedAsset}</Text>
                    </View>
                  </>
                )}
                <View style={styles.successRow}>
                  <Text style={[styles.successRowLabel, { color: colors.mutedForeground }]}>Duration</Text>
                  <Text style={[styles.successRowVal, { color: colors.foreground }]}>{selectedDuration === "custom" ? customDurationLabel : selectedDurationData.label}</Text>
                </View>
                <View style={styles.successRow}>
                  <Text style={[styles.successRowLabel, { color: colors.mutedForeground }]}>Unlocks</Text>
                  <Text style={[styles.successRowVal, { color: colors.primary }]}>{getEndDate(selectedDuration)}</Text>
                </View>
                {lockResult?.txHash ? (
                  <View style={styles.successRow}>
                    <Text style={[styles.successRowLabel, { color: colors.mutedForeground }]}>Tx Hash</Text>
                    <Text style={[styles.successRowVal, { color: colors.foreground }]} numberOfLines={1} ellipsizeMode="middle">
                      {lockResult.txHash.slice(0, 10)}...{lockResult.txHash.slice(-8)}
                    </Text>
                  </View>
                ) : null}
              </View>

              <TouchableOpacity
                style={[styles.lockBtn, { backgroundColor: colors.primary, width: "100%" }]}
                onPress={closeNewLockModal}
              >
                <Text style={[styles.lockBtnText, { color: colors.primaryForeground }]}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : showPin ? (
            <View style={styles.confirmView}>
              <Feather name="lock" size={40} color={colors.primary} style={{ alignSelf: "center", marginBottom: 4 }} />
              <Text style={[styles.confirmTitle, { color: colors.foreground }]}>Confirm with PIN</Text>
              <Text style={[styles.confirmSub, { color: colors.mutedForeground }]}>
                Enter your 4-digit PIN to confirm this lock transaction.
              </Text>
              <View style={{ flexDirection: "row", justifyContent: "center", gap: 12, marginTop: 20, marginBottom: 16 }}>
                {pin.map((d, i) => (
                  <TextInput
                    key={i}
                    ref={(r) => { pinRefs.current[i] = r; }}
                    style={{
                      width: 48, height: 56, borderRadius: 12, borderWidth: 2, textAlign: "center",
                      fontSize: 22, fontFamily: "Inter_600SemiBold",
                      color: colors.foreground,
                      backgroundColor: colors.card,
                      borderColor: pinError ? colors.destructive : pin[i] ? colors.primary : colors.border,
                    }}
                    keyboardType="number-pad"
                    maxLength={1}
                    secureTextEntry
                    value={d}
                    onChangeText={(v) => handlePinInput(v, i)}
                    onKeyPress={({ nativeEvent }) => {
                      if (nativeEvent.key === "Backspace" && !pin[i] && i > 0) {
                        const newPin = [...pin];
                        newPin[i - 1] = "";
                        setPin(newPin);
                        pinRefs.current[i - 1]?.focus();
                      }
                    }}
                  />
                ))}
              </View>
              {pinError && (
                <Text style={{ color: colors.destructive, textAlign: "center", fontFamily: "Inter_500Medium", fontSize: 13, marginBottom: 8 }}>
                  Incorrect PIN. Try again.
                </Text>
              )}
              <TouchableOpacity
                style={[styles.confirmBtnSecondary, { borderColor: colors.border, marginTop: 12, alignSelf: "center", paddingHorizontal: 32 }]}
                onPress={() => setShowPin(false)}
                disabled={submitting}
              >
                <Text style={[styles.confirmBtnSecondaryText, { color: colors.foreground }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : showConfirm ? (
            <ScrollView contentContainerStyle={styles.confirmView} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Feather name="alert-triangle" size={40} color={colors.primary} style={{ alignSelf: "center", marginBottom: 4 }} />
              <Text style={[styles.confirmTitle, { color: colors.foreground }]}>Confirm Lock</Text>
              <Text style={[styles.confirmSub, { color: colors.mutedForeground }]}>
                Please review the details below. Once confirmed, your tokens will be locked on-chain and{" "}
                <Text style={{ color: colors.destructive, fontFamily: "Inter_600SemiBold" }}>cannot be withdrawn</Text> until the unlock date.
              </Text>

              <View style={[styles.confirmCard, { backgroundColor: colors.card }]}>
                {[
                  ...(lockName.trim() ? [{ label: "Lock Name", value: lockName.trim() }] : []),
                  { label: "Asset", value: selectedAsset },
                  { label: "Network", value: selectedChain.name },
                  { label: "Lock Amount", value: `${amount} ${selectedAsset}` },
                  { label: "Lock Fee (0.5%)", value: `${lockFeeAmount.toFixed(td(selectedAsset))} ${selectedAsset}` },
                  { label: "Total Deducted", value: `${(numAmount + lockFeeAmount).toFixed(td(selectedAsset))} ${selectedAsset}`, bold: true },
                  { label: "Lock Period", value: selectedDuration === "custom" ? customDurationLabel : selectedDurationData.label },
                  { label: "Unlock Date", value: getEndDate(selectedDuration) },
                ].map((row, i) => (
                  <View key={row.label} style={styles.confirmRow}>
                    <Text style={[styles.confirmRowLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
                    <Text style={[styles.confirmRowVal, { color: (row as any).bold ? colors.foreground : colors.foreground }]}>{row.value}</Text>
                  </View>
                ))}
              </View>

              <View style={[styles.confirmWarning, { backgroundColor: colors.destructive + "10" }]}>
                <Feather name="lock" size={14} color={colors.destructive} />
                <Text style={[styles.confirmWarningText, { color: colors.destructive }]}>
                  This lock is executed on-chain. You will not be able to withdraw your tokens before the unlock date under any circumstances.
                </Text>
              </View>

              <View style={[styles.confirmWarning, { backgroundColor: colors.primary + "10" }]}>
                <Feather name="plus-circle" size={14} color={colors.primary} />
                <Text style={[styles.confirmWarningText, { color: colors.primary }]}>
                  You can add more {selectedAsset} to this lock anytime before it expires.
                </Text>
              </View>

              <View style={styles.confirmBtns}>
                <TouchableOpacity
                  style={[styles.confirmBtnSecondary, { borderColor: colors.border }]}
                  onPress={() => setShowConfirm(false)}
                  disabled={submitting}
                >
                  <Text style={[styles.confirmBtnSecondaryText, { color: colors.foreground }]}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtnPrimary, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]}
                  onPress={() => requestPin(() => confirmLock())}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Feather name="lock" size={16} color={colors.primaryForeground} />
                  )}
                  <Text style={[styles.confirmBtnPrimaryText, { color: colors.primaryForeground }]}>
                    {submitting ? "Locking on-chain..." : "Confirm Lock"}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.createBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {/* Big amount input */}
              <View style={styles.createAmountWrap}>
                <View style={styles.createAmountRow}>
                  <TextInput
                    style={[styles.createAmountInput, { color: colors.foreground }]}
                    placeholder="0"
                    placeholderTextColor={colors.mutedForeground + "60"}
                    keyboardType="numeric"
                    value={amount}
                    onChangeText={(v) => { setAmount(v); if (amountError) setAmountError(""); }}
                  />
                  <Text style={[styles.createAmountAsset, { color: colors.mutedForeground }]}>{selectedAsset}</Text>
                </View>
                {numAmount > 0 && rates?.[selectedAsset]?.ngn ? (
                  <Text style={{ textAlign: "center", alignSelf: "center", fontSize: 14, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 }}>
                    ≈ ₦{(numAmount * rates[selectedAsset].ngn).toLocaleString("en-NG", { maximumFractionDigits: 0 })}
                  </Text>
                ) : null}
                <View style={styles.createBalRow}>
                  <Feather name="credit-card" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.createBalText, { color: colors.mutedForeground }]}>
                    {chainBalance.toFixed(td(selectedAsset))} {selectedAsset} available
                  </Text>
                  <TouchableOpacity onPress={() => { setAmount(String(Math.floor(chainBalance / 1.01 * 10000) / 10000)); setAmountError(""); }}>
                    <Text style={[styles.createMaxBtn, { color: colors.primary }]}>MAX</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {amountError ? (
                <View style={[styles.inlineError, { backgroundColor: colors.destructive + "12", marginTop: -4 }]}>
                  <Feather name="alert-circle" size={14} color={colors.destructive} />
                  <Text style={[styles.inlineErrorText, { color: colors.destructive }]}>{amountError}</Text>
                </View>
              ) : null}

              {/* Asset toggle */}
              <View style={[styles.createSection, { backgroundColor: colors.card }]}>
                <View style={styles.createSectionRow}>
                  <Text style={[styles.createSectionLabel, { color: colors.mutedForeground }]}>Asset</Text>
                  <View style={[styles.createToggle, { backgroundColor: colors.background }]}>
                    {(["USDC", "USDT"] as Asset[]).map((a) => {
                      const active = selectedAsset === a;
                      return (
                        <TouchableOpacity
                          key={a}
                          style={[styles.createToggleBtn, active && { backgroundColor: colors.primary + "18" }]}
                          onPress={() => handleAssetChange(a)}
                        >
                          <TokenLogo symbol={a} size={16} />
                          <Text style={[styles.createToggleTxt, { color: active ? colors.primary : colors.mutedForeground }]}>{a}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Network */}
                <View style={[styles.createDivider, { backgroundColor: colors.border }]} />
                <TouchableOpacity style={styles.createSectionRow} onPress={() => setChainDropdownOpen(!chainDropdownOpen)} activeOpacity={0.7}>
                  <Text style={[styles.createSectionLabel, { color: colors.mutedForeground }]}>Network</Text>
                  <View style={styles.createNetworkVal}>
                    {CHAIN_LOGOS[selectedChain.tag] ? (
                      <Image source={CHAIN_LOGOS[selectedChain.tag]} style={{ width: 18, height: 18, borderRadius: 9 }} />
                    ) : null}
                    <Text style={[styles.createSectionVal, { color: colors.foreground }]}>{selectedChain.name}</Text>
                    <Feather name={chainDropdownOpen ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
                  </View>
                </TouchableOpacity>
                {chainDropdownOpen && (
                  <View style={{ paddingLeft: 12, paddingBottom: 4 }}>
                    {ASSET_CHAINS[selectedAsset].map((net) => {
                      const active = selectedChain.tag === net.tag;
                      return (
                        <TouchableOpacity
                          key={net.tag}
                          style={[styles.createDropdownItem, active && { backgroundColor: colors.primary + "10" }]}
                          onPress={() => { setSelectedChain(net); setChainDropdownOpen(false); }}
                        >
                          {CHAIN_LOGOS[net.tag] && <Image source={CHAIN_LOGOS[net.tag]} style={{ width: 16, height: 16, borderRadius: 8 }} />}
                          <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: active ? colors.primary : colors.foreground }}>{net.name}</Text>
                          {active && <Feather name="check" size={14} color={colors.primary} style={{ marginLeft: "auto" }} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {/* Lock name */}
                <View style={[styles.createDivider, { backgroundColor: colors.border }]} />
                <View style={styles.createSectionRow}>
                  <Text style={[styles.createSectionLabel, { color: colors.mutedForeground }]}>Name</Text>
                  <TextInput
                    style={[styles.createNameInput, { color: colors.foreground }]}
                    placeholder="Optional"
                    placeholderTextColor={colors.mutedForeground + "80"}
                    value={lockName}
                    onChangeText={(v) => setLockName(v.slice(0, 50))}
                    maxLength={50}
                  />
                </View>
              </View>

              {/* Duration chips */}
              <View style={styles.createDurWrap}>
                <Text style={[styles.createDurLabel, { color: colors.mutedForeground }]}>Lock Period</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  // flexGrow:0: a horizontal scroller in a column stretches otherwise.
                  style={styles.createDurBar}
                  contentContainerStyle={styles.createDurRow}
                >
                  {DURATIONS.map((d) => {
                    const active = selectedDuration === d.key;
                    return (
                      <TouchableOpacity
                        key={d.key}
                        style={[
                          styles.createDurChip,
                          { backgroundColor: active ? colors.primary : colors.card, borderColor: active ? colors.primary : colors.border },
                        ]}
                        onPress={() => {
                          setSelectedDuration(d.key);
                          if (d.key === "custom") setShowDatePicker(true);
                        }}
                      >
                        <Text style={[styles.createDurChipTxt, { color: active ? colors.primaryForeground : colors.foreground }]}>
                          {d.key === "custom" && customUnlockDate && selectedDuration === "custom" ? customDurationLabel : d.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                {selectedDuration === "custom" && !customUnlockDate ? (
                  <TouchableOpacity onPress={() => setShowDatePicker(true)}>
                    <Text style={[styles.createUnlockHint, { color: colors.primary }]}>
                      Tap to select unlock date
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={[styles.createUnlockHint, { color: colors.mutedForeground }]}>
                    Unlocks {getEndDate(selectedDuration)}
                  </Text>
                )}
                {showDatePicker && (
                  <DateTimePicker
                    value={customUnlockDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)}
                    mode="date"
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    minimumDate={new Date(Date.now() + 60 * 1000)}
                    maximumDate={new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)}
                    onChange={(event, date) => {
                      setShowDatePicker(Platform.OS === "ios");
                      if (date) setCustomUnlockDate(date);
                    }}
                  />
                )}
              </View>

              {/* Fee summary */}
              {numAmount > 0 ? (
                <View style={[styles.createFeeRow, { backgroundColor: colors.card }]}>
                  <View style={styles.createFeeItem}>
                    <Text style={[styles.createFeeLabel, { color: colors.mutedForeground }]}>Fee (0.5%)</Text>
                    <Text style={[styles.createFeeVal, { color: colors.foreground }]}>{lockFeeAmount.toFixed(td(selectedAsset))} {selectedAsset}</Text>
                  </View>
                  <View style={[styles.createFeeDot, { backgroundColor: colors.border }]} />
                  <View style={styles.createFeeItem}>
                    <Text style={[styles.createFeeLabel, { color: colors.mutedForeground }]}>Total</Text>
                    <Text style={[styles.createFeeVal, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>{(numAmount + lockFeeAmount).toFixed(td(selectedAsset))} {selectedAsset}</Text>
                    {rates?.[selectedAsset]?.ngn ? (
                      <Text style={[styles.createFeeLabel, { color: colors.primary, marginTop: 2 }]}>
                        ≈ ₦{((numAmount + lockFeeAmount) * rates[selectedAsset].ngn).toLocaleString("en-NG", { maximumFractionDigits: 0 })}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {/* Lock button */}
              <TouchableOpacity
                style={[styles.lockBtn, { backgroundColor: colors.primary }]}
                onPress={handleLockPress}
              >
                <Feather name="lock" size={16} color={colors.primaryForeground} />
                <Text style={[styles.lockBtnText, { color: colors.primaryForeground }]}>
                  {numAmount > 0 ? `Lock ${amount} ${selectedAsset}` : "Lock Tokens"}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Detail Modal */}
      {detailPlan && (
        <Modal visible transparent animationType="slide" onRequestClose={() => { if (!submitting && !addSubmitting) closeDetailModal(); }}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={0}
          >
          <TouchableOpacity
            style={styles.detailOverlay}
            activeOpacity={1}
            onPress={() => { if (!submitting && !addSubmitting) closeDetailModal(); }}
          >
            <View
              style={[styles.detailSheet, { backgroundColor: colors.card, paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 20, maxHeight: "85%" }]}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.detailSheetHeader}>
                <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
                <TouchableOpacity style={[styles.detailCloseBtn, { backgroundColor: colors.muted }]} onPress={closeDetailModal} hitSlop={8} disabled={submitting || addSubmitting}>
                  <Feather name="x" size={18} color={submitting || addSubmitting ? colors.border : colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              {/* Withdraw Success */}
              {withdrawSuccess ? (
                <View style={{ gap: 16, paddingVertical: 24, alignItems: "center" }}>
                  <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "#22c55e14", alignItems: "center", justifyContent: "center" }}>
                    <Feather name="check-circle" size={36} color="#22c55e" />
                  </View>
                  <Text style={[styles.detailAmount, { color: colors.foreground, fontSize: 22 }]}>Withdrawal Successful</Text>
                  <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", lineHeight: 21 }}>
                    {detailPlan.amount.toFixed(td(detailPlan.asset))} {detailPlan.asset} has been withdrawn to your wallet.
                  </Text>
                  <View style={[styles.detailInfo, { backgroundColor: colors.background, width: "100%" }]}>
                    {[
                      { label: "Amount", value: `${detailPlan.amount.toFixed(td(detailPlan.asset))} ${detailPlan.asset}` },
                      ...(detailPlan.name ? [{ label: "Lock Name", value: detailPlan.name }] : []),
                      { label: "Duration", value: getDurationLabel(detailPlan.durationDays) },
                      { label: "Chain", value: detailPlan.chain || "Movement" },
                    ].map((row) => (
                      <View key={row.label} style={styles.detailRow}>
                        <Text style={[styles.detailRowLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
                        <Text style={[styles.detailRowVal, { color: colors.foreground }]}>{row.value}</Text>
                      </View>
                    ))}
                  </View>
                  <TouchableOpacity
                    style={[styles.lockBtn, { backgroundColor: colors.primary, width: "100%", marginTop: 4 }]}
                    onPress={closeDetailModal}
                  >
                    <Text style={[styles.lockBtnText, { color: colors.primaryForeground }]}>Done</Text>
                  </TouchableOpacity>
                </View>
              ) : showFlex ? (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
                  <ViewShot ref={flexShotRef} options={{ format: "png", quality: 1 }}>
                  <View style={[styles.flexReceipt, { backgroundColor: colors.card }]}>
                    {/* Receipt header */}
                    <View style={styles.flexHeader}>
                      <View style={styles.flexTitleRow}>
                        <Feather
                          name={detailPlan.status === "ACTIVE" ? (isUnlocked(detailPlan.endDate) ? "unlock" : "lock") : "check-circle"}
                          size={20}
                          color={colors.foreground}
                        />
                        <Text style={[styles.flexTitle, { color: colors.foreground }]}>
                          {detailPlan.status === "WITHDRAWN" ? "Savings Withdrawn" : isUnlocked(detailPlan.endDate) ? "Savings Unlocked" : "Savings Locked"}
                        </Text>
                      </View>
                    </View>

                    {/* Big amount */}
                    <View style={styles.flexAmountWrap}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={[styles.flexAmount, { color: colors.foreground }]}>
                          {detailPlan.amount.toFixed(td(detailPlan.asset))}
                        </Text>
                        <TokenLogo symbol={detailPlan.asset} size={28} />
                      </View>
                      {detailPlan.name ? (
                        <Text style={[styles.flexSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
                          {detailPlan.name}
                        </Text>
                      ) : null}
                    </View>

                    {/* Divider */}
                    <View style={[styles.flexDivider, { backgroundColor: colors.border }]} />

                    {/* Receipt rows */}
                    <View style={styles.flexRows}>
                      {[
                        { label: "Status", value: detailPlan.status === "ACTIVE" ? (isUnlocked(detailPlan.endDate) ? "Unlocked" : "Locked") : detailPlan.status === "WITHDRAWN" ? "Withdrawn" : "Completed", icon: "activity" as const },
                        { label: "Duration", value: getDurationLabel(detailPlan.durationDays), icon: "clock" as const },
                        { label: "Chain", value: detailPlan.chain || "Movement", icon: "link" as const },
                        { label: "Locked On", value: new Date(detailPlan.startDate).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }), icon: "calendar" as const },
                        { label: "Unlock Date", value: new Date(detailPlan.endDate).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }), icon: "calendar" as const },

                      ].map((row) => (
                        <View key={row.label} style={styles.flexRow}>
                          <View style={styles.flexRowLeft}>
                            <Feather name={row.icon} size={14} color={colors.mutedForeground} />
                            <Text style={[styles.flexRowLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
                          </View>
                          <Text style={[styles.flexRowVal, { color: colors.foreground }]}>{row.value}</Text>
                        </View>
                      ))}
                    </View>

                    {/* Divider */}
                    <View style={[styles.flexDivider, { backgroundColor: colors.border }]} />

                    {/* Branding */}
                    <View style={styles.flexFooter}>
                      <Feather name="shield" size={14} color={colors.primary} />
                      <Text style={[styles.flexFooterText, { color: colors.mutedForeground }]}>
                        Secured on-chain · MoneyMoves
                      </Text>
                    </View>
                  </View>
                  </ViewShot>

                  {/* Buttons */}
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                    <TouchableOpacity
                      style={[styles.lockBtn, { flex: 1, backgroundColor: colors.muted }]}
                      onPress={() => setShowFlex(false)}
                    >
                      <Feather name="arrow-left" size={16} color={colors.foreground} />
                      <Text style={[styles.lockBtnText, { color: colors.foreground }]}>Back</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.lockBtn, { flex: 2, backgroundColor: colors.primary }]}
                      onPress={async () => {
                        try {
                          const uri = await flexShotRef.current?.capture?.();
                          if (uri && (await Sharing.isAvailableAsync())) {
                            await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share Flex" });
                          } else {
                            const status = detailPlan.status === "ACTIVE" ? (isUnlocked(detailPlan.endDate) ? "Unlocked" : "Locked") : detailPlan.status === "WITHDRAWN" ? "Withdrawn" : "Completed";
                            const durLabel = getDurationLabel(detailPlan.durationDays);
                            const msg = `${detailPlan.name ? `"${detailPlan.name}" — ` : ""}I ${status === "Locked" ? "locked" : status === "Withdrawn" ? "withdrew" : "unlocked"} ${detailPlan.amount.toFixed(td(detailPlan.asset))} ${detailPlan.asset} for ${durLabel} on MoneyMoves Savings Vault!\n\nSecured on-chain with MoneyMoves`;
                            await Share.share({ message: msg });
                          }
                        } catch {}
                      }}
                    >
                      <Feather name="share-2" size={16} color={colors.primaryForeground} />
                      <Text style={[styles.lockBtnText, { color: colors.primaryForeground }]}>Share Flex</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              ) : addResult ? (
                <View style={{ gap: 14, paddingVertical: 12 }}>
                  <View style={{ alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Feather name="check-circle" size={44} color="#22c55e" />
                    <Text style={[styles.detailAmount, { color: colors.foreground }]}>Tokens Added!</Text>
                  </View>
                  <View style={[styles.detailInfo, { backgroundColor: colors.background }]}>
                    {[
                      { label: "New Total Locked", value: `${addResult.amount.toFixed(td(detailPlan.asset))} ${detailPlan.asset}` },
                      { label: "Fee (0.5%)", value: `${addResult.fee.toFixed(td(detailPlan.asset))} ${detailPlan.asset}` },
                      { label: "Tx Hash", value: addResult.txHash ? `${addResult.txHash.slice(0, 10)}...${addResult.txHash.slice(-8)}` : "—" },
                    ].map((row) => (
                      <View key={row.label} style={styles.detailRow}>
                        <Text style={[styles.detailRowLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
                        <Text style={[styles.detailRowVal, { color: colors.foreground }]}>{row.value}</Text>
                      </View>
                    ))}
                  </View>
                  <TouchableOpacity
                    style={[styles.lockBtn, { backgroundColor: colors.primary, marginTop: 8 }]}
                    onPress={closeDetailModal}
                  >
                    <Text style={[styles.lockBtnText, { color: colors.primaryForeground }]}>Done</Text>
                  </TouchableOpacity>
                </View>
              ) : showAddPin ? (
                /* Add-to-lock PIN verification */
                <View style={{ gap: 16, paddingVertical: 12, alignItems: "center" }}>
                  <Feather name="lock" size={28} color={colors.primary} />
                  <Text style={[styles.detailAmount, { color: colors.foreground }]}>Enter PIN to confirm</Text>
                  <Text style={[styles.detailSub, { color: colors.mutedForeground }]}>
                    Adding {Number(addAmount).toFixed(td(detailPlan.asset))} {detailPlan.asset} to lock
                  </Text>
                  <View style={styles.pinRow}>
                    {addPin.map((d, i) => (
                      <TextInput
                        key={i}
                        ref={(r) => (addPinRefs.current[i] = r)}
                        style={[styles.pinInput, { borderColor: addPinError ? colors.destructive : addPin[i] ? colors.primary : colors.border, color: colors.foreground, backgroundColor: colors.background }]}
                        value={d}
                        onChangeText={(v) => handleAddPinInput(v.replace(/[^0-9]/g, ""), i)}
                        onKeyPress={({ nativeEvent }) => {
                          if (nativeEvent.key === "Backspace" && !addPin[i] && i > 0) {
                            const newPin = [...addPin];
                            newPin[i - 1] = "";
                            setAddPin(newPin);
                            addPinRefs.current[i - 1]?.focus();
                          }
                        }}
                        keyboardType="number-pad"
                        maxLength={1}
                        secureTextEntry
                        textAlign="center"
                      />
                    ))}
                  </View>
                  {addPinError && <Text style={{ color: colors.destructive, fontSize: 13 }}>Incorrect PIN</Text>}
                  {addSubmitting && <ActivityIndicator size="small" color={colors.primary} />}
                  <TouchableOpacity onPress={() => setShowAddPin(false)}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : showAddForm ? (
                /* Add-to-lock amount form */
                <View style={{ gap: 12, paddingVertical: 8 }}>
                  <Text style={[styles.detailAmount, { color: colors.foreground, fontSize: 17 }]}>Add Tokens to Lock</Text>
                  <Text style={[styles.detailSub, { color: colors.mutedForeground }]}>
                    Balance: {(walletBalances.find(b => b.asset === detailPlan.asset && b.chain === (detailPlan.chain || "MOVE"))?.balance ?? 0).toFixed(td(detailPlan.asset))} {detailPlan.asset}
                  </Text>
                  <View style={[styles.amountBox, { backgroundColor: colors.background, borderColor: addAmountError ? colors.destructive : colors.border }]}>
                    <TextInput
                      style={[styles.amountInput, { color: colors.foreground }]}
                      placeholder={`0.00`}
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="decimal-pad"
                      value={addAmount}
                      onChangeText={(t) => { setAddAmount(t); setAddAmountError(""); }}
                    />
                    <Text style={[styles.amountAsset, { color: colors.mutedForeground }]}>{detailPlan.asset}</Text>
                  </View>
                  {addAmountError ? (
                    <View style={[styles.inlineError, { backgroundColor: colors.destructive + "12" }]}>
                      <Feather name="alert-circle" size={14} color={colors.destructive} />
                      <Text style={[styles.inlineErrorText, { color: colors.destructive }]}>{addAmountError}</Text>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                    <TouchableOpacity
                      style={[styles.lockBtn, { flex: 1, backgroundColor: colors.muted }]}
                      onPress={() => { setShowAddForm(false); setAddAmount(""); setAddAmountError(""); }}
                    >
                      <Text style={[styles.lockBtnText, { color: colors.foreground }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.lockBtn, { flex: 1, backgroundColor: colors.primary }]}
                      onPress={handleAddPress}
                      disabled={addSubmitting}
                    >
                      {addSubmitting ? (
                        <ActivityIndicator size="small" color={colors.primaryForeground} />
                      ) : (
                        <Feather name="plus" size={16} color={colors.primaryForeground} />
                      )}
                      <Text style={[styles.lockBtnText, { color: colors.primaryForeground }]}>
                        {addSubmitting ? "Adding..." : "Add Tokens"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                /* Normal detail view */
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 4 }}>
                  {/* Plan header */}
                  <View style={{ alignItems: "center", gap: 8, marginTop: 8, marginBottom: 4 }}>
                    <View style={[styles.detailBadge, {
                      backgroundColor: detailPlan.status === "ACTIVE"
                        ? (isUnlocked(detailPlan.endDate) ? "#22c55e20" : colors.primary + "18")
                        : colors.mutedForeground + "18"
                    }]}>
                      <Feather
                        name={detailPlan.status === "ACTIVE" ? (isUnlocked(detailPlan.endDate) ? "unlock" : "lock") : "check-circle"}
                        size={26}
                        color={detailPlan.status === "ACTIVE" ? (isUnlocked(detailPlan.endDate) ? "#22c55e" : colors.primary) : colors.mutedForeground}
                      />
                    </View>
                    {detailPlan.name ? (
                      <Text style={[styles.detailAmount, { color: colors.mutedForeground, fontSize: 15, textAlign: "center" }]} numberOfLines={1}>
                        {detailPlan.name}
                      </Text>
                    ) : null}
                    <Text style={[styles.detailAmount, { color: colors.foreground, fontSize: 26, textAlign: "center" }]}>
                      {detailPlan.amount.toFixed(td(detailPlan.asset))} {detailPlan.asset}
                    </Text>
                    <View style={[styles.detailStatusPill, {
                      backgroundColor: detailPlan.status === "ACTIVE"
                        ? (isUnlocked(detailPlan.endDate) ? "#22c55e18" : colors.primary + "18")
                        : detailPlan.status === "WITHDRAWN" ? colors.mutedForeground + "18" : "#22c55e18"
                    }]}>
                      <View style={[styles.detailStatusDot, {
                        backgroundColor: detailPlan.status === "ACTIVE"
                          ? (isUnlocked(detailPlan.endDate) ? "#22c55e" : colors.primary)
                          : detailPlan.status === "WITHDRAWN" ? colors.mutedForeground : "#22c55e"
                      }]} />
                      <Text style={[styles.detailStatusText, {
                        color: detailPlan.status === "ACTIVE"
                          ? (isUnlocked(detailPlan.endDate) ? "#22c55e" : colors.primary)
                          : detailPlan.status === "WITHDRAWN" ? colors.mutedForeground : "#22c55e"
                      }]}>
                        {detailPlan.status === "ACTIVE" ? (isUnlocked(detailPlan.endDate) ? "Unlocked" : "Locked") : detailPlan.status === "WITHDRAWN" ? "Withdrawn" : "Completed"}
                      </Text>
                    </View>
                  </View>



                  {/* Info rows */}
                  <View style={[styles.detailInfo, { backgroundColor: colors.background }]}>
                    {([
                      { label: "Asset", value: detailPlan.asset, icon: "disc" as const },
                      { label: "Chain", value: detailPlan.chain || "Movement", icon: "link" as const },
                      { label: "Amount Locked", value: `${detailPlan.amount.toFixed(td(detailPlan.asset))} ${detailPlan.asset}`, icon: "lock" as const },
                      { label: "Lock Fee (0.5%)", value: `${(detailPlan.amount * LOCK_FEE).toFixed(td(detailPlan.asset))} ${detailPlan.asset}`, icon: "percent" as const },
                      { label: "Duration", value: getDurationLabel(detailPlan.durationDays), icon: "clock" as const },
                      { label: "Locked On", value: new Date(detailPlan.startDate).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }), icon: "calendar" as const },
                      { label: "Unlock Date", value: new Date(detailPlan.endDate).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }), icon: "calendar" as const },
                    ] as { label: string; value: string; icon: React.ComponentProps<typeof Feather>["name"] }[]).map((row) => (
                      <View key={row.label} style={styles.detailRow}>
                        <View style={styles.detailRowLeft}>
                          <View style={[styles.detailRowIcon, { backgroundColor: colors.muted }]}>
                            <Feather name={row.icon} size={13} color={colors.mutedForeground} />
                          </View>
                          <Text style={[styles.detailRowLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
                        </View>
                        <Text style={[styles.detailRowVal, { color: colors.foreground }]}>{row.value}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Tx Hash button */}
                  {detailPlan.txHash ? (
                    <TouchableOpacity
                      style={[styles.txHashBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                      onPress={() => {
                        const url = `https://explorer.movementnetwork.xyz/txn/${detailPlan.txHash}`;
                        Linking.openURL(url).catch(() => {});
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.detailRowLeft}>
                        <View style={[styles.detailRowIcon, { backgroundColor: colors.primary + "14" }]}>
                          <Feather name="hash" size={13} color={colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.detailRowLabel, { color: colors.mutedForeground, fontSize: 11 }]}>Transaction Hash</Text>
                          <Text style={[styles.detailRowVal, { color: colors.foreground, fontSize: 12 }]} numberOfLines={1}>
                            {detailPlan.txHash.slice(0, 14)}...{detailPlan.txHash.slice(-10)}
                          </Text>
                        </View>
                      </View>
                      <View style={[styles.txHashExplorerBadge, { backgroundColor: colors.primary + "14" }]}>
                        <Feather name="external-link" size={12} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontSize: 11, fontFamily: "Inter_600SemiBold" }}>Explorer</Text>
                      </View>
                    </TouchableOpacity>
                  ) : null}

                  {/* Withdraw error */}
                  {withdrawError ? (
                    <View style={[styles.inlineError, { backgroundColor: colors.destructive + "12", marginTop: 12 }]}>
                      <Feather name="alert-circle" size={14} color={colors.destructive} />
                      <Text style={[styles.inlineErrorText, { color: colors.destructive }]}>{withdrawError}</Text>
                    </View>
                  ) : null}

                  {/* Action buttons (active plans only) */}
                  {detailPlan.status === "ACTIVE" && (
                    <View style={{ gap: 10, marginTop: 16 }}>
                      {isUnlocked(detailPlan.endDate) ? (
                        /* Unlocked: Flex + Withdraw on same row */
                        <View style={{ flexDirection: "row", gap: 10 }}>
                          <TouchableOpacity
                            style={[styles.lockBtn, { flex: 3, backgroundColor: colors.primary + "14", borderWidth: 1, borderColor: colors.primary }]}
                            onPress={() => setShowFlex(true)}
                          >
                            <Feather name="award" size={16} color={colors.primary} />
                            <Text style={[styles.lockBtnText, { color: colors.primary }]}>Flex</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.lockBtn, { flex: 7, backgroundColor: colors.foreground }]}
                            onPress={handleWithdrawFromDetail}
                            disabled={submitting}
                          >
                            {submitting ? (
                              <ActivityIndicator size="small" color={colors.background} />
                            ) : (
                              <Feather name="unlock" size={16} color={colors.background} />
                            )}
                            <Text style={[styles.lockBtnText, { color: colors.background }]}>
                              {submitting ? "Withdrawing..." : "Withdraw"}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        /* Still locked: Add+Flex same row, locked label below */
                        <>
                          <View style={{ flexDirection: "row", gap: 10 }}>
                            <TouchableOpacity
                              style={[styles.lockBtn, { flex: 3, backgroundColor: colors.primary + "14", borderWidth: 1, borderColor: colors.primary }]}
                              onPress={() => setShowFlex(true)}
                            >
                              <Feather name="award" size={16} color={colors.primary} />
                              <Text style={[styles.lockBtnText, { color: colors.primary }]}>Flex</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.lockBtn, { flex: 7, backgroundColor: colors.primary }]}
                              onPress={() => { setShowAddForm(true); setAddAmountError(""); }}
                            >
                              <Feather name="plus" size={16} color={colors.primaryForeground} />
                              <Text style={[styles.lockBtnText, { color: colors.primaryForeground }]}>Add More {detailPlan.asset} to Lock</Text>
                            </TouchableOpacity>
                          </View>
                          <TouchableOpacity
                            style={[styles.lockBtn, { backgroundColor: colors.muted }]}
                            onPress={handleWithdrawFromDetail}
                            disabled={submitting}
                          >
                            <Feather name="lock" size={16} color={colors.mutedForeground} />
                            <Text style={[styles.lockBtnText, { color: colors.mutedForeground }]}>
                              Locked until {new Date(detailPlan.endDate).toLocaleDateString()}
                            </Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  )}

                  {/* Flex button for withdrawn/completed */}
                  {detailPlan.status !== "ACTIVE" && (
                    <View style={{ gap: 10, marginTop: 16 }}>
                      <TouchableOpacity
                        style={[styles.lockBtn, { backgroundColor: colors.primary + "14", borderWidth: 1, borderColor: colors.primary }]}
                        onPress={() => setShowFlex(true)}
                      >
                        <Feather name="award" size={16} color={colors.primary} />
                        <Text style={[styles.lockBtnText, { color: colors.primary }]}>Flex</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </ScrollView>
              )}
            </View>
          </TouchableOpacity>
          </KeyboardAvoidingView>
        </Modal>
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
    paddingBottom: 20,
  },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  pageSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  newBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },

  /* Hero summary */
  heroCard: {
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 24,
    marginBottom: 28,
    gap: 16,
  },
  heroLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 1 },
  heroAmount: { fontSize: 40, fontFamily: "Inter_700Bold", letterSpacing: -1.5 },
  heroChips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  heroChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  heroChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  /* Sections */
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  sectionCount: { fontSize: 13, fontFamily: "Inter_500Medium" },
  section: { paddingHorizontal: 20, gap: 10, marginBottom: 28 },

  /* History total card */
  historyTotalCard: { borderRadius: 16, padding: 16, borderWidth: 1, marginBottom: 4 },

  /* Active lock cards */
  lockCard: { borderRadius: 16, padding: 16, gap: 12 },
  lockCardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  lockCardIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  lockCardInfo: { flex: 1, gap: 1 },
  lockCardName: { fontSize: 12, fontFamily: "Inter_500Medium" },
  lockCardAmount: { fontSize: 17, fontFamily: "Inter_700Bold" },
  lockCardPct: { fontSize: 15, fontFamily: "Inter_700Bold" },
  lockCardBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  lockCardBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  lockCardTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  lockCardFill: { height: 4, borderRadius: 2 },
  lockCardBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  lockCardMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  lockCardMetaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  lockCardRemaining: { fontSize: 12, fontFamily: "Inter_500Medium" },

  /* History cards */
  historyCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14 },
  historyIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  historyName: { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 1 },
  historyAmount: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  historyMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  historyStatusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  historyStatusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  /* View more / View all */
  viewMoreBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12, marginTop: 2 },
  viewMoreText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  /* Empty state */
  empty: { alignItems: "center", paddingTop: 80, paddingHorizontal: 40, gap: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  emptyBtn: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14, marginTop: 12 },
  emptyBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  /* Inline error */
  inlineError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginTop: 4,
  },
  inlineErrorText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },

  /* Success view */
  successView: { alignItems: "center", paddingTop: 48, paddingHorizontal: 24, gap: 12 },
  successCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  successTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  successSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21, marginBottom: 8 },
  successDetails: { width: "100%", borderRadius: 14, padding: 16, gap: 14, marginBottom: 8 },
  successRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  successRowLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  successRowVal: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  /* Modal */
  modal: { flex: 1, paddingTop: 12 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 12 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  modalBody: { padding: 20, gap: 20, paddingBottom: 40 },
  modalLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },

  assetBtnRow: { flexDirection: "row", gap: 12 },
  assetBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  assetBtnInner: { flexDirection: "row", alignItems: "center", gap: 10 },
  assetBtnLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  amountNetworkRow: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  networkPicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    height: 60,
  },
  networkPickerText: { fontSize: 13, fontFamily: "Inter_500Medium", maxWidth: 80 },
  balanceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: -8 },
  balanceLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  balanceVal: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  dropdownList: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: -8,
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  dropdownItemText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  chainLogo: { width: 20, height: 20, borderRadius: 10 },

  amountBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 60,
  },
  amountInput: { flex: 1, fontSize: 24, fontFamily: "Inter_600SemiBold" },
  amountAsset: { fontSize: 15, fontFamily: "Inter_500Medium" },

  durationGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  durationBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  durationLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },

  lockBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 56,
    borderRadius: 14,
  },
  lockBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },

  /* Create lock modal — compact redesign */
  createBody: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40, gap: 16 },
  createAmountWrap: { alignItems: "center", paddingVertical: 12, gap: 8 },
  createAmountRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", position: "relative", width: "100%" },
  createAmountInput: { fontSize: 48, fontFamily: "Inter_700Bold", minWidth: 60, textAlign: "center", letterSpacing: -2, paddingVertical: 0, flexShrink: 1 },
  createAmountAsset: { fontSize: 18, fontFamily: "Inter_500Medium", position: "absolute", right: 16, bottom: 6 },
  createBalRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  createBalText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  createMaxBtn: { fontSize: 12, fontFamily: "Inter_700Bold", marginLeft: 4 },
  createSection: { borderRadius: 16, paddingVertical: 4, paddingHorizontal: 16 },
  createSectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14 },
  createSectionLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  createSectionVal: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  createDivider: { height: StyleSheet.hairlineWidth },
  createToggle: { flexDirection: "row", borderRadius: 10, padding: 3, gap: 2 },
  createToggleBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  createToggleTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  createNetworkVal: { flexDirection: "row", alignItems: "center", gap: 6 },
  createNameInput: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "right", paddingVertical: 0 },
  createDropdownItem: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
  createDurWrap: { gap: 10 },
  createDurLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  createDurBar: { flexGrow: 0 },
  createDurRow: { gap: 8 },
  createDurChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
  createDurChipTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  createUnlockHint: { fontSize: 12, fontFamily: "Inter_400Regular" },
  createFeeRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16 },
  createFeeItem: { flex: 1, gap: 2 },
  createFeeLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  createFeeVal: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  createFeeDot: { width: 3, height: 3, borderRadius: 2, marginHorizontal: 12 },

  /* Confirm view */
  confirmView: { padding: 20, gap: 16 },
  confirmTitle: { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  confirmSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21 },
  confirmCard: { borderRadius: 14, padding: 16, gap: 14 },
  confirmRow: { flexDirection: "row", justifyContent: "space-between" },
  confirmRowLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  confirmRowVal: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  confirmWarning: { flexDirection: "row", gap: 10, padding: 14, borderRadius: 12, alignItems: "flex-start" },
  confirmWarningText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  confirmBtns: { flexDirection: "row", gap: 12, marginTop: 4 },
  confirmBtnSecondary: { flex: 1, height: 52, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  confirmBtnSecondaryText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  confirmBtnPrimary: { flex: 2, height: 52, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  confirmBtnPrimaryText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  /* Detail sheet */
  detailOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  detailSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  detailSheetHeader: {
    alignItems: "center",
    marginBottom: 4,
  },
  detailCloseBtn: {
    position: "absolute",
    right: 0,
    top: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  detailTop: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 8 },
  detailBadge: { width: 56, height: 56, borderRadius: 28, alignItems: "center" as const, justifyContent: "center" as const },
  detailAmount: { fontSize: 20, fontFamily: "Inter_700Bold" },
  detailSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  detailStatusPill: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  detailStatusDot: { width: 7, height: 7, borderRadius: 4 },
  detailStatusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  detailProgressLabel: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "right" },
  detailInfo: { borderRadius: 14, padding: 16, marginTop: 16, gap: 14 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailRowLeft: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
  detailRowIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center" as const, justifyContent: "center" as const },
  detailRowLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  detailRowVal: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  /* Tx Hash button */
  txHashBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginTop: 10,
    gap: 10,
  },
  txHashExplorerBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },

  /* PIN row */
  pinRow: { flexDirection: "row", justifyContent: "center", gap: 12, marginTop: 4, marginBottom: 8 },
  pinInput: {
    width: 48, height: 56, borderRadius: 12, borderWidth: 2,
    textAlign: "center", fontSize: 22, fontFamily: "Inter_600SemiBold",
  },

  /* Flex receipt */
  flexReceipt: {
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 20,
    gap: 16,
    marginTop: 8,
  },
  flexHeader: { alignItems: "center", gap: 8 },
  flexTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  flexTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  flexSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  flexAmountWrap: { alignItems: "center", gap: 2, paddingVertical: 4 },
  flexAmount: { fontSize: 38, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  flexAsset: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  flexDivider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  flexRows: { gap: 12 },
  flexRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  flexRowLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  flexRowLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  flexRowVal: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  flexFooter: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingTop: 4 },
  flexFooterText: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
