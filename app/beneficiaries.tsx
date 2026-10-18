import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View, Text, TouchableOpacity, TextInput, Platform, ScrollView, StyleSheet,
  ActivityIndicator, Alert, Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { bankLogoSource, CHAIN_MARKS, TOKEN_NETWORKS } from "@/constants/transfer";
import {
  getBeneficiaries,
  deleteBeneficiary,
  toggleFavourite,
  type Beneficiary,
} from "@/services/beneficiaries";
import {
  listCryptoContacts,
  updateCryptoContact,
  deleteCryptoContact,
  type CryptoContact,
} from "@/services/crypto-contacts";

type Tab = "bank" | "wallet";

/** What both list endpoints accept. Asking for more is a 400, not a longer list. */
const PAGE = 50;

const getInitials = (name: string) =>
  name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/** 0x7a3f…9c21 - enough to recognise, short enough for one line. */
const shortAddress = (a: string) =>
  a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

/** MOVE -> Movement, from the same table the send flow reads. */
const chainName = (tag: string) => {
  for (const nets of Object.values(TOKEN_NETWORKS)) {
    const hit = nets.find((n) => n.tag === tag);
    if (hit) return hit.name;
  }
  return tag;
};

export default function BeneficiariesScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [tab, setTab] = useState<Tab>("bank");
  const [search, setSearch] = useState("");
  const [banks, setBanks] = useState<Beneficiary[]>([]);
  const [wallets, setWallets] = useState<CryptoContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      // Both lists at once, so switching tabs is instant and the counts hold.
      const [b, w] = await Promise.all([
        getBeneficiaries({ limit: PAGE }).then((r) => r.beneficiaries),
        listCryptoContacts({ limit: PAGE }),
      ]);
      setBanks(b);
      setWallets(w);
    } catch {
      // Said out loud rather than rendered as "nothing saved yet", which is a
      // different and much more alarming thing to tell someone.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Saved first, then most recent.
   *
   * Recent and Favourite used to be two tabs over the same rows, which meant
   * looking in two places for one person. Starring now lifts a row into the
   * Saved group of the list it already belongs to.
   */
  const bankRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return banks
      .filter((b) =>
        !q ||
        b.accountName.toLowerCase().includes(q) ||
        b.accountNumber.includes(q) ||
        b.bankName.toLowerCase().includes(q))
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [banks, search]);

  const walletRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return wallets
      .filter((c) =>
        !q ||
        (c.label || "").toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        chainName(c.chain).toLowerCase().includes(q))
      .sort((a, b) => +new Date(b.lastUsedAt) - +new Date(a.lastUsedAt));
  }, [wallets, search]);

  const rows: any[] = tab === "bank" ? bankRows : walletRows;
  const saved = rows.filter((r) => r.favourite);
  const others = rows.filter((r) => !r.favourite);

  const starBank = async (b: Beneficiary) => {
    // Flipped first, reconciled after: a star that waits on the network feels
    // broken even when it works.
    setBanks((prev) => prev.map((x) => (x.id === b.id ? { ...x, favourite: !x.favourite } : x)));
    try {
      await toggleFavourite(b.id);
    } catch {
      setBanks((prev) => prev.map((x) => (x.id === b.id ? { ...x, favourite: b.favourite } : x)));
    }
  };

  const starWallet = async (c: CryptoContact) => {
    setWallets((prev) => prev.map((x) => (x.id === c.id ? { ...x, favourite: !x.favourite } : x)));
    try {
      await updateCryptoContact(c.id, { favourite: !c.favourite });
    } catch {
      setWallets((prev) => prev.map((x) => (x.id === c.id ? { ...x, favourite: c.favourite } : x)));
    }
  };

  const remove = (item: any) => {
    const isBank = tab === "bank";
    Alert.alert(
      isBank ? "Remove beneficiary" : "Remove address",
      isBank
        ? `${item.accountName} · ${item.accountNumber}`
        : item.label || shortAddress(item.address),
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              if (isBank) {
                await deleteBeneficiary(item.id);
                setBanks((prev) => prev.filter((x) => x.id !== item.id));
              } else {
                await deleteCryptoContact(item.id);
                setWallets((prev) => prev.filter((x) => x.id !== item.id));
              }
            } catch {}
          },
        },
      ],
    );
  };

  const Row = ({ item, last }: { item: any; last: boolean }) => {
    const isBank = tab === "bank";
    const logo = isBank ? bankLogoSource(item.bankName) : null;
    const mark = !isBank ? CHAIN_MARKS[item.chain] : null;

    return (
      <View
        style={[
          s.row,
          !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
        ]}
      >
        <View style={[s.mark, { backgroundColor: colors.background }]}>
          {logo ? (
            <Image source={logo} style={s.markImg} />
          ) : mark ? (
            <Image source={mark} style={s.markImg} />
          ) : (
            <Text style={[s.markText, { color: colors.primary }]}>
              {isBank ? getInitials(item.accountName) : "0x"}
            </Text>
          )}
        </View>

        <View style={s.rowMid}>
          <Text style={[s.rowName, { color: colors.foreground }]} numberOfLines={1}>
            {isBank ? item.accountName : item.label || shortAddress(item.address)}
          </Text>
          <Text style={[s.rowMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {isBank
              ? `${item.bankName} · ${item.accountNumber}`
              : `${chainName(item.chain)} · ${shortAddress(item.address)}`}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => (isBank ? starBank(item) : starWallet(item))}
          hitSlop={8}
          style={s.action}
          activeOpacity={0.7}
        >
          <Feather
            name="star"
            size={17}
            color={item.favourite ? colors.primary : colors.mutedForeground}
            style={!item.favourite && { opacity: 0.5 }}
          />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => remove(item)} hitSlop={8} style={s.action} activeOpacity={0.7}>
          {/* Muted, not red. A red control on every row made the list read as
              a page of warnings. */}
          <Feather name="trash-2" size={17} color={colors.mutedForeground} style={{ opacity: 0.5 }} />
        </TouchableOpacity>
      </View>
    );
  };

  const Group = ({ label, data }: { label?: string; data: any[] }) => {
    if (!data.length) return null;
    return (
      <>
        {!!label && (
          <Text style={[s.groupLabel, { color: colors.mutedForeground }]}>{label}</Text>
        )}
        <View style={[s.card, { backgroundColor: colors.card }]}>
          {data.map((item, i) => (
            <Row key={item.id} item={item} last={i === data.length - 1} />
          ))}
        </View>
      </>
    );
  };

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>Beneficiaries</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* One control, two halves - not two loose pills. The whole thing is the
          switch, so it reads as a choice between the two lists. */}
      <View style={[s.segment, { backgroundColor: colors.card }]}>
        {([
          { key: "bank" as Tab, label: "Bank accounts", n: banks.length },
          { key: "wallet" as Tab, label: "Wallet addresses", n: wallets.length },
        ]).map((t) => {
          const on = t.key === tab;
          return (
            <TouchableOpacity
              key={t.key}
              style={[s.segmentItem, on && { backgroundColor: colors.background }]}
              onPress={() => setTab(t.key)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  s.segmentText,
                  { color: on ? colors.foreground : colors.mutedForeground },
                ]}
              >
                {t.label}
              </Text>
              {t.n > 0 && (
                <Text style={[s.segmentCount, { color: on ? colors.primary : colors.mutedForeground }]}>
                  {t.n}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Only once there is enough to sift through. A search box above an empty
          list is furniture. */}
      {rows.length + (search ? 1 : 0) > 4 && (
        <View style={[s.searchBox, { backgroundColor: colors.card }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[s.searchInput, { color: colors.foreground }]}
            placeholder={tab === "bank" ? "Name, bank or account number" : "Label, network or address"}
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")} hitSlop={8}>
              <Feather name="x" size={15} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      )}

      <ScrollView
        contentContainerStyle={
          rows.length === 0 ? { flexGrow: 1 } : { paddingBottom: bottomPad + 30 }
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : failed ? (
          <View style={s.center}>
            <Text style={[s.emptyTitle, { color: colors.foreground }]}>Could not load</Text>
            <Text style={[s.emptyText, { color: colors.mutedForeground }]}>
              Check your connection and try again.
            </Text>
            <TouchableOpacity onPress={load} style={s.retryBtn} activeOpacity={0.7}>
              <Text style={[s.retryText, { color: colors.primary }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : rows.length === 0 ? (
          <View style={s.center}>
            <Text style={[s.emptyTitle, { color: colors.foreground }]}>
              {search ? "No matches" : tab === "bank" ? "No bank accounts yet" : "No saved addresses yet"}
            </Text>
            <Text style={[s.emptyText, { color: colors.mutedForeground }]}>
              {search
                ? "Try a different name or number."
                : tab === "bank"
                  ? "Accounts you send to are kept here."
                  : "Wallet addresses you send to are kept here."}
            </Text>
          </View>
        ) : (
          <>
            <Group label={saved.length ? "SAVED" : undefined} data={saved} />
            <Group label={saved.length ? "RECENT" : undefined} data={others} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },

  segment: {
    flexDirection: "row",
    marginHorizontal: 20,
    padding: 4,
    borderRadius: 14,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 40,
    borderRadius: 11,
  },
  segmentText: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  segmentCount: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_700Bold" },

  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 9,
    marginHorizontal: 20, marginTop: 12,
    borderRadius: 13, paddingHorizontal: 13, height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },

  groupLabel: {
    fontSize: 10.5, lineHeight: 14, fontFamily: "Inter_700Bold", letterSpacing: 1.1,
    marginTop: 22, marginBottom: 8, marginLeft: 22,
  },
  card: { marginHorizontal: 20, marginTop: 14, borderRadius: 18, paddingHorizontal: 14 },

  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 },
  mark: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  markImg: { width: 28, height: 28, borderRadius: 14, resizeMode: "contain" as const },
  markText: { fontSize: 13.5, fontFamily: "Inter_700Bold" },
  rowMid: { flex: 1, gap: 3 },
  rowName: { fontSize: 14.5, lineHeight: 19, fontFamily: "Inter_600SemiBold" },
  rowMeta: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular" },
  action: { paddingHorizontal: 5, paddingVertical: 6 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, paddingBottom: 80 },
  emptyTitle: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 5 },
  retryBtn: { paddingVertical: 12, paddingHorizontal: 18, marginTop: 4 },
  retryText: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
});
