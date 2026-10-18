import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, TextInput, Platform, Modal, FlatList, ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";
import { ts, NIGERIAN_BANKS } from "@/constants/transfer";
import {
  getBeneficiaries,
  resolveAccount as resolveAccountApi,
  type Beneficiary,
} from "@/services/beneficiaries";

export default function BankSelectScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const searchParams = useLocalSearchParams<{
    from?: string;
    sellToken?: string;
    sellChain?: string;
    sellAmount?: string;
  }>();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const kbHeight = useKeyboardHeight();
  const isSell = searchParams.from === "sell";

  const [selectedBank, setSelectedBank] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [showBankSheet, setShowBankSheet] = useState(false);
  const [bankSearch, setBankSearch] = useState("");
  const [benTab, setBenTab] = useState<"recent" | "favourite">("recent");
  const [bankError, setBankError] = useState("");
  const [accountError, setAccountError] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolvedBankCode, setResolvedBankCode] = useState("");
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [loadingBen, setLoadingBen] = useState(true);

  const filteredBanks = bankSearch
    ? NIGERIAN_BANKS.filter((b) => b.toLowerCase().includes(bankSearch.toLowerCase()))
    : NIGERIAN_BANKS;

  const filteredBeneficiaries = benTab === "favourite"
    ? beneficiaries.filter((b) => b.favourite)
    : beneficiaries;

  const fetchBeneficiaries = useCallback(async () => {
    try {
      setLoadingBen(true);
      const { beneficiaries: bens } = await getBeneficiaries({ limit: 10 });
      setBeneficiaries(bens);
    } catch {}
    setLoadingBen(false);
  }, []);

  useEffect(() => { fetchBeneficiaries(); }, [fetchBeneficiaries]);

  const resolveAccount = useCallback(async () => {
    if (accountNumber.length < 10 || !selectedBank) return;
    setResolving(true);
    try {
      const result = await resolveAccountApi({
        accountNumber,
        bankName: selectedBank,
      });
      if (result.resolved && result.accountName) {
        setAccountName(result.accountName);
        if (result.bankCode) setResolvedBankCode(result.bankCode);
      } else {
        setAccountName("");
      }
    } catch {
      setAccountName("");
    }
    setResolving(false);
  }, [accountNumber, selectedBank]);

  // Auto-resolve when both bank and 10-digit account number are present
  useEffect(() => {
    if (accountNumber.length === 10 && selectedBank) {
      setAccountName("");
      resolveAccount();
    }
  }, [accountNumber, selectedBank]);

  const handleContinue = () => {
    if (!selectedBank) { setBankError("Please select a bank"); return; }
    if (accountNumber.length < 10) { setAccountError("Enter a valid 10-digit account number"); return; }
    if (!accountName) { setAccountError("Account could not be verified"); return; }
    if (isSell) {
      router.push({
        pathname: "/sell-summary",
        params: {
          bank: selectedBank, accountNumber, accountName,
          sellToken: searchParams.sellToken || "USDC",
          sellChain: searchParams.sellChain || "MOVE",
          sellAmount: searchParams.sellAmount || "0",
          bankCode: resolvedBankCode || "",
        },
      } as any);
    } else {
      router.push({
        pathname: "/bank-amount",
        params: { bank: selectedBank, accountNumber, accountName },
      } as any);
    }
  };

  const selectBeneficiary = (b: Beneficiary) => {
    if (isSell) {
      router.push({
        pathname: "/sell-summary",
        params: {
          bank: b.bankName, accountNumber: b.accountNumber, accountName: b.accountName,
          sellToken: searchParams.sellToken || "USDC",
          sellChain: searchParams.sellChain || "MOVE",
          sellAmount: searchParams.sellAmount || "0",
          bankCode: b.bankCode || "",
        },
      } as any);
    } else {
      router.push({
        pathname: "/bank-amount",
        params: { bank: b.bankName, accountNumber: b.accountNumber, accountName: b.accountName },
      } as any);
    }
  };

  return (
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={ts.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[ts.headerTitle, { color: colors.foreground }]}>{isSell ? "Select Bank" : "Bank Transfer"}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: bottomPad + 20 }} keyboardShouldPersistTaps="handled">
        <View style={[ts.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity style={[ts.fieldRow, { borderColor: bankError ? "#ef4444" : colors.border }]} onPress={() => { setShowBankSheet(true); if (bankError) setBankError(""); }}>
            {selectedBank ? (
              <View style={ts.bankSelectedRow}>
                <View style={[ts.bankDot, { backgroundColor: "#ef4444" }]} />
                <Text style={[ts.fieldValue, { color: colors.foreground }]}>{selectedBank}</Text>
              </View>
            ) : (
              <Text style={[ts.fieldPlaceholder, { color: colors.mutedForeground }]}>Select bank</Text>
            )}
            <Feather name="chevron-down" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
          {bankError ? <Text style={{ color: "#ef4444", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 6 }}>{bankError}</Text> : null}

          <View style={[ts.fieldRow, { borderColor: accountError ? "#ef4444" : colors.border }]}>
            <TextInput
              style={[ts.fieldInput, { color: colors.foreground }]}
              placeholder="Account Number"
              placeholderTextColor={colors.mutedForeground}
              value={accountNumber}
              onChangeText={(t) => { setAccountNumber(t.replace(/[^0-9]/g, "").slice(0, 10)); setAccountName(""); if (accountError) setAccountError(""); }}
              onBlur={resolveAccount}
              keyboardType="number-pad"
              maxLength={10}
            />
          </View>
          {accountError ? <Text style={{ color: "#ef4444", fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 6 }}>{accountError}</Text> : null}

          {accountName !== "" && (
            <View style={[ts.verifiedRow, { backgroundColor: colors.primary + "18" }]}>
              <Text style={[ts.verifiedName, { color: colors.foreground }]}>{accountName}</Text>
              <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
            </View>
          )}
          {resolving && (
            <View style={[ts.verifiedRow, { backgroundColor: colors.muted + "30" }]}>
              <Text style={[ts.verifiedName, { color: colors.mutedForeground }]}>Verifying account...</Text>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          )}

          <TouchableOpacity style={[ts.primaryBtn, { backgroundColor: colors.primary }]} onPress={handleContinue}>
            <Text style={[ts.primaryBtnText, { color: colors.primaryForeground }]}>Continue</Text>
          </TouchableOpacity>
        </View>

        {/* Beneficiaries */}
        <View style={ts.benSection}>
          <View style={ts.benHeader}>
            <View style={ts.benTabs}>
              {(["recent", "favourite"] as const).map((t) => (
                <TouchableOpacity key={t} onPress={() => setBenTab(t)}>
                  <Text style={[
                    ts.benTabText,
                    { color: benTab === t ? colors.foreground : colors.mutedForeground },
                    benTab === t && { borderBottomWidth: 2, borderBottomColor: colors.primary, paddingBottom: 6 },
                  ]}>
                    {t === "recent" ? "Recent" : "Favourite"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={() => router.push("/beneficiaries" as any)}>
              <Text style={[ts.viewAllText, { color: colors.primary }]}>View All</Text>
            </TouchableOpacity>
          </View>
          {loadingBen ? (
            <View style={{ paddingVertical: 30, alignItems: "center" }}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : filteredBeneficiaries.length === 0 ? (
            <View style={{ paddingVertical: 30, alignItems: "center" }}>
              <Feather name="users" size={28} color={colors.muted} />
              <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 8 }}>
                {benTab === "favourite" ? "No favourites yet" : "No recent beneficiaries"}
              </Text>
            </View>
          ) : (
          filteredBeneficiaries.map((b, i) => (
            <TouchableOpacity key={b.id} style={[ts.benRow, { borderBottomColor: colors.border }]} onPress={() => selectBeneficiary(b)}>
              <View style={[ts.benDot, { backgroundColor: colors.primary }]}>
                <Feather name="user" size={14} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[ts.benName, { color: colors.foreground }]}>{b.accountName}</Text>
                <Text style={[ts.benMeta, { color: colors.mutedForeground }]}>{b.accountNumber} ({b.bankName})</Text>
              </View>
              {b.favourite && (
                <Feather name="star" size={14} color={colors.primary} style={{ marginRight: 4 }} />
              )}
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))
          )}
        </View>
      </ScrollView>

      {/* Bank selector modal */}
      {showBankSheet && (
        <Modal transparent animationType="slide" visible>
          {/* No KeyboardAvoidingView. On iOS a Modal is its own window and is
              already resized for the keyboard, so a KAV inside one adds that
              height a second time and pushes the sheet off-screen - which reads
              as the screen going blank rather than as a layout error. The
              search field autofocuses here, so the keyboard is up immediately
              and the sheet was blank on arrival. */}
          <View style={ts.modalOverlay}>
            <View
              style={[
                ts.bankSheet,
                {
                  backgroundColor: colors.card,
                  paddingBottom: kbHeight > 0 ? kbHeight + 16 : bottomPad + 20,
                },
              ]}
            >
              <View style={ts.bankSheetHeader}>
                <Text style={[ts.bankSheetTitle, { color: colors.foreground }]}>Banks</Text>
                <TouchableOpacity onPress={() => { setShowBankSheet(false); setBankSearch(""); }}>
                  <Feather name="x" size={22} color={colors.foreground} />
                </TouchableOpacity>
              </View>
              <View style={[ts.bankSearchWrap, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Feather name="search" size={18} color={colors.mutedForeground} />
                <TextInput
                  style={[ts.bankSearchInput, { color: colors.foreground }]}
                  placeholder="Search by bank name"
                  placeholderTextColor={colors.mutedForeground}
                  value={bankSearch}
                  onChangeText={setBankSearch}
                  autoFocus
                />
              </View>
              <FlatList
                data={filteredBanks}
                keyExtractor={(item) => item}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[ts.bankItem, { borderBottomColor: colors.border }]}
                    onPress={() => { setSelectedBank(item); setShowBankSheet(false); setBankSearch(""); setAccountName(""); if (bankError) setBankError(""); }}
                  >
                    <View style={[ts.bankItemIcon, { backgroundColor: colors.primary + "18" }]}>
                      <Feather name="home" size={16} color={colors.primary} />
                    </View>
                    <Text style={[ts.bankItemText, { color: colors.foreground }]}>{item}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}
