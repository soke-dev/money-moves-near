import React, { useState, useCallback, useMemo } from "react";
import {
  View, Text, TouchableOpacity, TextInput, Platform, ActivityIndicator, StyleSheet, ScrollView,
  Image, Modal,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { lookupUsername, type LookupUser } from "@/services/user";
import { ts } from "@/constants/transfer";

export default function UsernameLookupScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { transactions } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [username, setUsername] = useState("");
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [foundUser, setFoundUser] = useState<LookupUser | null>(null);

  const recentRecipients = useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; username: string }[] = [];
    for (const tx of transactions) {
      if (tx.type !== "TRANSFER_OUT") continue;
      const meta = tx.metadata as any;
      const uname: string = meta?.recipientUsername;
      const uid: string = meta?.recipientId;
      if (!uname || !uid || seen.has(uname)) continue;
      seen.add(uname);
      list.push({ id: uid, username: uname });
      if (list.length === 5) break;
    }
    return list;
  }, [transactions]);

  const handleRecipientTap = (recipient: { id: string; username: string }) => {
    router.push({
      pathname: "/username-send",
      params: {
        recipientId: recipient.id,
        recipientUsername: recipient.username,
        recipientName: recipient.username,
      },
    } as any);
  };

  const handleSearch = useCallback(async () => {
    const trimmed = username.trim();
    if (trimmed.length < 3) {
      setError("Username must be at least 3 characters");
      return;
    }
    setLoading(true);
    setError(null);
    setFoundUser(null);
    try {
      const result = await lookupUsername(trimmed);
      setFoundUser(result);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err: any) {
      const msg = err?.response?.data?.error || "User not found";
      setError(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }, [username]);

  const handleProceed = () => {
    if (!foundUser) return;
    router.push({
      pathname: "/username-send",
      params: {
        recipientId: foundUser.id,
        recipientUsername: foundUser.username,
        recipientName: [foundUser.firstName, foundUser.lastName].filter(Boolean).join(" ") || foundUser.username,
      },
    } as any);
  };

  const displayName = foundUser
    ? [foundUser.firstName, foundUser.lastName].filter(Boolean).join(" ") || foundUser.username
    : "";

  return (
    /**
     * No KeyboardAvoidingView.
     *
     * It used to wrap the whole screen, header included, so opening the
     * keyboard padded the entire view and the content collapsed out of sight.
     * The list insets itself instead, which is the only part that needs to
     * move.
     */
    <View style={[ts.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={ts.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[ts.headerTitle, { color: colors.foreground }]}>Send to username</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 8 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        {foundUser ? (
          /* The person, then what you can do with them. Tapping the card used
             to be the only way back to the field, which meant the one obvious
             gesture on a confirmation screen was "undo it" - so the actions
             are spelled out instead. */
          <View style={[s.card, s.spaced, { backgroundColor: colors.card }]}>
            <View style={s.recipHead}>
              <Feather name="check" size={15} color={colors.primary} />
              <Text style={[s.recipLabel, { color: colors.primary }]}>Recipient</Text>
            </View>

            <View style={s.recipBody}>
              <View style={[s.recipAvatar, { backgroundColor: colors.muted }]}>
                {foundUser.avatarUrl ? (
                  <Image source={{ uri: foundUser.avatarUrl }} style={s.recipAvatarImg} />
                ) : (
                  <Text style={[s.recipInitial, { color: colors.primary }]}>
                    {(displayName || foundUser.username).charAt(0).toUpperCase()}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.recipName, { color: colors.foreground }]} numberOfLines={1}>
                  {displayName}
                </Text>
                <Text style={[s.recipHandle, { color: colors.mutedForeground }]} numberOfLines={1}>
                  @{foundUser.username}
                </Text>
              </View>
            </View>

            <View style={[s.recipActions, { borderTopColor: colors.border }]}>
              <TouchableOpacity
                style={s.recipAction}
                onPress={() => {
                  Clipboard.setStringAsync(foundUser.username);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                }}
                activeOpacity={0.7}
              >
                <Feather name={copied ? "check" : "copy"} size={14} color={colors.mutedForeground} />
                <Text style={[s.recipActionText, { color: colors.mutedForeground }]}>
                  {copied ? "Copied" : "Copy"}
                </Text>
              </TouchableOpacity>

              <View style={[s.recipDivider, { backgroundColor: colors.border }]} />

              <TouchableOpacity style={s.recipAction} onPress={() => setShowCode(true)} activeOpacity={0.7}>
                <Image
                  source={require("@/assets/images/qr-code.png")}
                  style={[s.recipActionMark, { tintColor: colors.mutedForeground }]}
                  resizeMode="contain"
                />
                <Text style={[s.recipActionText, { color: colors.mutedForeground }]}>Code</Text>
              </TouchableOpacity>

              <View style={[s.recipDivider, { backgroundColor: colors.border }]} />

              <TouchableOpacity
                style={s.recipAction}
                onPress={() => { setFoundUser(null); setError(null); }}
                activeOpacity={0.7}
              >
                <Feather name="edit-2" size={13} color={colors.mutedForeground} />
                <Text style={[s.recipActionText, { color: colors.mutedForeground }]}>Change</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>Send to new recipient</Text>

            <View style={[s.card, { backgroundColor: colors.card }]}>
              <View style={s.inputRow}>
                <Text style={[s.at, { color: colors.mutedForeground }]}>@</Text>
                <TextInput
                  style={[s.input, { color: colors.foreground }]}
                  placeholder="Enter username"
                  placeholderTextColor={colors.mutedForeground}
                  value={username}
                  onChangeText={(t) => { setUsername(t.replace(/\s/g, "")); setFoundUser(null); setError(null); }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onSubmitEditing={handleSearch}
                  returnKeyType="search"
                />
                {loading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <TouchableOpacity
                    style={[
                      s.searchPill,
                      { backgroundColor: colors.muted, opacity: username.trim().length < 3 ? 0.4 : 1 },
                    ]}
                    onPress={handleSearch}
                    disabled={username.trim().length < 3}
                    activeOpacity={0.75}
                  >
                    <Text style={[s.searchText, { color: colors.foreground }]}>Search</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {!!error && <Text style={[s.err, { color: colors.destructive }]}>{error}</Text>}

            {recentRecipients.length > 0 && (
              <>
                <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>Recent</Text>
                <View style={[s.card, { backgroundColor: colors.card }]}>
                  {recentRecipients.map((r, i) => (
                    <View key={r.id}>
                      {i > 0 && <View style={[s.rule, { backgroundColor: colors.border }]} />}
                      <TouchableOpacity
                        style={s.recentRow}
                        onPress={() => handleRecipientTap(r)}
                        activeOpacity={0.75}
                      >
                        <View style={[s.recentDisc, { backgroundColor: colors.muted }]}>
                          <Text style={[s.recentInitial, { color: colors.mutedForeground }]}>
                            {r.username[0].toUpperCase()}
                          </Text>
                        </View>
                        <Text style={[s.recentName, { color: colors.foreground }]} numberOfLines={1}>
                          @{r.username}
                        </Text>
                        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      {foundUser && (
        <View style={[ts.bottomBar, { paddingBottom: bottomPad + 16, backgroundColor: colors.background }]}>
          <TouchableOpacity
            style={[ts.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={handleProceed}
            activeOpacity={0.85}
          >
            <Text style={[ts.primaryBtnText, { color: colors.primaryForeground }]}>Continue</Text>
          </TouchableOpacity>
        </View>
      )}
      {showCode && foundUser && (
        <Modal transparent animationType="fade" visible>
          <TouchableOpacity style={s.codeOverlay} activeOpacity={1} onPress={() => setShowCode(false)}>
            <View style={[s.codeCard, { backgroundColor: colors.card }]} onStartShouldSetResponder={() => true}>
              {/* White panel whatever the theme: a dark code on a dark card is
                  one most scanners will not read. */}
              <View style={s.codePanel}>
                <QRCode
                  value={foundUser.username}
                  size={196}
                  backgroundColor="#fff"
                  color="#000"
                  logo={require("@/assets/images/logo-qr.png")}
                  logoSize={34}
                  logoBackgroundColor="#fff"
                  logoBorderRadius={17}
                  logoMargin={4}
                />
              </View>
              <Text style={[s.codeHandle, { color: colors.foreground }]} numberOfLines={1}>
                @{foundUser.username}
              </Text>
              <TouchableOpacity
                style={[s.codeClose, { backgroundColor: colors.muted }]}
                onPress={() => setShowCode(false)}
                activeOpacity={0.8}
              >
                <Text style={[s.codeCloseText, { color: colors.foreground }]}>Done</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

    </View>
  );
}

const s = StyleSheet.create({
  sectionLabel: {
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: "Inter_500Medium",
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
  },

  card: { marginHorizontal: 16, borderRadius: 18, paddingHorizontal: 16 },
  spaced: { marginTop: 16, paddingVertical: 14 },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: -16 },

  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 13 },
  at: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  input: { flex: 1, fontSize: 15, lineHeight: 20, fontFamily: "Inter_500Medium", paddingVertical: 2 },
  searchPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  searchText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold" },

  err: {
    fontSize: 12.5,
    lineHeight: 17,
    fontFamily: "Inter_500Medium",
    paddingHorizontal: 22,
    marginTop: 8,
  },

  recipHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  recipLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  recipBody: { flexDirection: "row", alignItems: "center", gap: 13, marginTop: 12 },
  recipAvatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  recipAvatarImg: { width: "100%", height: "100%" },
  recipInitial: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_700Bold" },
  recipName: { fontSize: 17, lineHeight: 23, fontFamily: "Inter_700Bold" },
  recipHandle: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", marginTop: 2 },
  // A seam across the card, so the actions read as belonging to this person.
  recipActions: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    marginHorizontal: -16,
    paddingHorizontal: 4,
  },
  recipAction: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13 },
  recipActionMark: { width: 14, height: 14 },
  recipActionText: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold" },
  recipDivider: { width: StyleSheet.hairlineWidth, height: 18 },

  codeOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 28 },
  codeCard: { width: "100%", borderRadius: 26, padding: 22, alignItems: "center" },
  codePanel: { backgroundColor: "#fff", borderRadius: 18, padding: 14 },
  codeHandle: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3, marginTop: 16 },
  codeClose: { alignSelf: "stretch", height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", marginTop: 18 },
  codeCloseText: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold" },

  recentRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 },
  recentDisc: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  recentInitial: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_700Bold" },
  recentName: { flex: 1, fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
});
