import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Share,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import {
  getReferralDashboard,
  claimReferralCode,
  type ReferralDashboard,
  type ReferralFriend,
} from "@/services/user";

/**
 * Referrals.
 *
 * No reward: a friend who finishes signing up moves you up the referral board,
 * and that is all this screen promises. It shows your code, who joined with
 * it, which of them count yet, and where that puts you.
 *
 * "Counted" and "pending" are the server's words for one rule - a friend
 * counts once their PIN is set - so the numbers here are the numbers on the
 * board.
 */
export default function ReferralDashboardScreen() {
  const colors = useColors();
  const { refreshUser } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [data, setData] = useState<ReferralDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [claimCode, setClaimCode] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimedBy, setClaimedBy] = useState<{ inviter: string | null } | null>(null);

  /**
   * Loads on every focus, so coming back from sharing shows anybody who has
   * joined since. `isAlive` stops a reply that lands after the screen has
   * gone from writing into it.
   */
  const load = useCallback(async (isAlive: () => boolean, pulled = false) => {
    if (pulled) setRefreshing(true);
    try {
      const d = await getReferralDashboard();
      if (!isAlive()) return;
      setData(d);
      setLoadError(null);
    } catch (e: any) {
      if (!isAlive()) return;
      setLoadError(e?.response?.data?.error || "Could not load your referrals.");
    } finally {
      if (isAlive()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      load(() => alive);
      return () => {
        alive = false;
      };
    }, [load]),
  );

  const copyCode = async () => {
    if (!data?.code) return;
    try {
      await Clipboard.setStringAsync(data.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const shareInvite = async () => {
    if (!data?.code) return;
    try {
      await Share.share({
        message: `I use Money Moves to move between naira and crypto. Sign up with my code ${data.code} at https://usemoneymoves.xyz`,
      });
    } catch {}
  };

  const submitClaim = async () => {
    const code = claimCode.replace(/\s+/g, "").toUpperCase();
    if (code.length < 4 || claiming) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const r = await claimReferralCode(code);
      setClaimedBy({ inviter: r.inviter ?? null });
      setClaimCode("");
      // The card goes once the server says the window is closed for them,
      // and the user refresh takes the "add a friend's code" prompts off
      // Account and Loyalty at the same moment.
      load(() => true);
      refreshUser();
    } catch (e: any) {
      setClaimError(e?.response?.data?.error || "Could not add that code. Try again.");
    } finally {
      setClaiming(false);
    }
  };

  const joined = (iso: string): string => {
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
    if (days <= 0) return "Joined today";
    if (days === 1) return "Joined yesterday";
    return `Joined ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  };

  const header = (
    <View style={s.header}>
      <TouchableOpacity onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
        <Feather name="arrow-left" size={24} color={colors.foreground} />
      </TouchableOpacity>
      <Text style={[s.title, { color: colors.foreground }]}>Referrals</Text>
      <View style={{ width: 24 }} />
    </View>
  );

  if (loading && !data) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header}
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
        {header}
        <View style={s.center}>
          <Text style={[s.errorText, { color: colors.mutedForeground }]}>{loadError}</Text>
          <TouchableOpacity
            style={[s.retry, { backgroundColor: colors.muted }]}
            onPress={() => {
              setLoading(true);
              load(() => true);
            }}
          >
            <Text style={[s.retryText, { color: colors.foreground }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const rankText = data.rank ? `#${data.rank}` : "Not yet";

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {header}

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: bottomPad + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(() => true, true)}
            tintColor={colors.primary}
          />
        }
      >
        {/* ── Add the code you forgot, inside the first week ──
            First on the page while it can still be done: it is the one
            thing here with a deadline, and a new account has no referrals
            of its own to look at yet. */}
        {claimedBy && (
          <View style={[s.claimDone, { backgroundColor: colors.primary + "14", borderColor: colors.primary + "40" }]}>
            <Feather name="check-circle" size={16} color={colors.primary} />
            <Text style={[s.claimDoneText, { color: colors.foreground }]}>
              {claimedBy.inviter ? `Code added. Invited by @${claimedBy.inviter}.` : "Code added."}
            </Text>
          </View>
        )}
        {data.claim.open && !claimedBy && (
          <View style={[s.claimCard, { borderColor: colors.border }]}>
            <Text style={[s.claimTitle, { color: colors.foreground }]}>Were you invited?</Text>
            <Text style={[s.claimBody, { color: colors.mutedForeground }]}>
              Add the code a friend gave you. You can do this once, in your first 7 days.
            </Text>
            <View style={s.claimRow}>
              <TextInput
                style={[
                  s.claimInput,
                  { borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground },
                ]}
                value={claimCode}
                onChangeText={(t) => {
                  setClaimCode(t.replace(/[^A-Za-z0-9]/g, "").slice(0, 16));
                  if (claimError) setClaimError(null);
                }}
                placeholder="Referral code"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!claiming}
                returnKeyType="done"
                onSubmitEditing={submitClaim}
                accessibilityLabel="Referral code"
              />
              <TouchableOpacity
                style={[
                  s.claimBtn,
                  { backgroundColor: colors.primary, opacity: claimCode.length >= 4 && !claiming ? 1 : 0.45 },
                ]}
                onPress={submitClaim}
                disabled={claimCode.length < 4 || claiming}
                activeOpacity={0.85}
              >
                {claiming ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={[s.claimBtnText, { color: colors.primaryForeground }]}>Add</Text>
                )}
              </TouchableOpacity>
            </View>
            {claimError ? (
              <Text style={[s.claimError, { color: colors.destructive }]}>{claimError}</Text>
            ) : (
              <Text style={[s.claimLeft, { color: colors.warning }]}>
                {data.claim.daysLeft === 1 ? "Last day to add one" : `${data.claim.daysLeft} days left`}
              </Text>
            )}
          </View>
        )}

        {/* ── Your code ── */}
        <View style={[s.codeCard, { backgroundColor: colors.card }]}>
          <Text style={[s.eyebrow, { color: colors.mutedForeground }]}>YOUR CODE</Text>
          <Text style={[s.code, { color: colors.foreground }]} selectable>
            {data.code}
          </Text>
          <View style={s.codeActions}>
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: colors.muted }]}
              onPress={copyCode}
              activeOpacity={0.8}
            >
              <Feather name={copied ? "check" : "copy"} size={16} color={colors.foreground} />
              <Text style={[s.actionText, { color: colors.foreground }]}>{copied ? "Copied" : "Copy"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: colors.primary }]}
              onPress={shareInvite}
              activeOpacity={0.85}
            >
              <Feather name="share" size={16} color={colors.primaryForeground} />
              <Text style={[s.actionText, s.actionTextStrong, { color: colors.primaryForeground }]}>
                Share invite
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── The three numbers ── */}
        <View style={s.stats}>
          <View style={[s.stat, { backgroundColor: colors.card }]}>
            <Text style={[s.statValue, { color: colors.primary }]}>{data.counted}</Text>
            <Text style={[s.statLabel, { color: colors.mutedForeground }]}>Counted</Text>
          </View>
          <View style={[s.stat, { backgroundColor: colors.card }]}>
            <Text style={[s.statValue, { color: colors.warning }]}>{data.pending}</Text>
            <Text style={[s.statLabel, { color: colors.mutedForeground }]}>Pending</Text>
          </View>
          <View style={[s.stat, { backgroundColor: colors.card }]}>
            <Text
              style={[s.statValue, !data.rank && s.statValueSmall, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {rankText}
            </Text>
            <Text style={[s.statLabel, { color: colors.mutedForeground }]}>On the board</Text>
          </View>
        </View>

        <Text style={[s.explain, { color: colors.mutedForeground }]}>
          A friend counts once they have verified their email and set a PIN. Until then they show as pending.
        </Text>

        {/* ── Who joined ── */}
        <Text style={[s.eyebrow, s.sectionLabel, { color: colors.mutedForeground }]}>FRIENDS</Text>

        {data.friends.length === 0 ? (
          <View style={[s.empty, { backgroundColor: colors.card }]}>
            <View style={[s.emptyDisc, { backgroundColor: colors.muted }]}>
              <Feather name="users" size={22} color={colors.mutedForeground} />
            </View>
            <Text style={[s.emptyTitle, { color: colors.foreground }]}>No friends here yet</Text>
            <Text style={[s.emptyBody, { color: colors.mutedForeground }]}>
              Share your code. Friends appear here as soon as they sign up with it.
            </Text>
          </View>
        ) : (
          <View>
            {data.friends.map((f: ReferralFriend, i: number) => (
              <View
                key={`${f.joinedAt}-${i}`}
                style={[
                  s.friend,
                  i < data.friends.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                ]}
              >
                <View style={[s.avatar, { backgroundColor: colors.muted }]}>
                  {f.anon ? (
                    <Feather name="eye-off" size={15} color={colors.mutedForeground} />
                  ) : (
                    <Text style={[s.avatarText, { color: colors.foreground }]}>
                      {(f.name || "?").charAt(0).toUpperCase()}
                    </Text>
                  )}
                </View>
                <View style={s.friendText}>
                  <Text style={[s.friendName, { color: colors.foreground }]} numberOfLines={1}>
                    {f.anon ? f.name : `@${f.name}`}
                  </Text>
                  <Text style={[s.friendSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {joined(f.joinedAt)}
                    {f.anon ? " · name hidden" : ""}
                    {!f.counted ? " · sign-up not finished" : ""}
                  </Text>
                </View>
                <View
                  style={[
                    s.pill,
                    { backgroundColor: (f.counted ? colors.primary : colors.warning) + "1F" },
                  ]}
                >
                  <Text style={[s.pillText, { color: f.counted ? colors.primary : colors.warning }]}>
                    {f.counted ? "Counted" : "Pending"}
                  </Text>
                </View>
              </View>
            ))}
            {data.counted + data.pending > data.friends.length && (
              <Text style={[s.more, { color: colors.mutedForeground }]}>
                Showing your {data.friends.length} most recent.
              </Text>
            )}
          </View>
        )}

        <TouchableOpacity
          style={[s.boardLink, { borderTopColor: colors.border }]}
          onPress={() => router.push({ pathname: "/leaderboard", params: { initialTab: "referrals" } } as any)}
          activeOpacity={0.7}
        >
          <Text style={[s.boardLinkText, { color: colors.foreground }]}>Referral leaderboard</Text>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </ScrollView>
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
  title: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_700Bold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 14 },
  errorText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular", textAlign: "center" },
  retry: { paddingHorizontal: 20, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  retryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  content: { paddingHorizontal: 20, paddingTop: 4 },

  codeCard: { borderRadius: 20, padding: 20, marginBottom: 12 },
  eyebrow: { fontSize: 11, lineHeight: 14, fontFamily: "Inter_600SemiBold", letterSpacing: 1.4 },
  code: { fontSize: 30, lineHeight: 38, fontFamily: "Inter_800ExtraBold", letterSpacing: 2, marginTop: 8 },
  codeActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  actionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  actionText: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  actionTextStrong: { fontFamily: "Inter_700Bold" },

  stats: { flexDirection: "row", gap: 10, marginBottom: 12 },
  stat: { flex: 1, borderRadius: 16, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12 },
  statValue: { fontSize: 24, lineHeight: 30, fontFamily: "Inter_800ExtraBold" },
  // "Not yet" in place of a rank: the same box, sized to fit the words.
  statValueSmall: { fontSize: 16, lineHeight: 30 },
  statLabel: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_500Medium", marginTop: 2 },

  explain: { fontSize: 12.5, lineHeight: 18, fontFamily: "Inter_400Regular", marginBottom: 20 },

  claimCard: { borderWidth: 1, borderRadius: 20, padding: 18, marginBottom: 14 },
  claimTitle: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_700Bold" },
  claimBody: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", marginTop: 4, marginBottom: 14 },
  claimRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  claimInput: {
    flex: 1,
    minWidth: 0,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 0,
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
  },
  claimBtn: { height: 48, minWidth: 72, paddingHorizontal: 20, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  claimBtnText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  claimLeft: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_500Medium", marginTop: 10 },
  claimError: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_500Medium", marginTop: 10 },
  claimDone: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  claimDoneText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_500Medium" },

  sectionLabel: { marginBottom: 6 },

  empty: { borderRadius: 20, paddingVertical: 28, paddingHorizontal: 24, alignItems: "center" },
  emptyDisc: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  emptyTitle: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  emptyBody: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 6 },

  friend: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, paddingVertical: 8 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  friendText: { flex: 1, minWidth: 0 },
  friendName: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  friendSub: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_600SemiBold" },
  more: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 10, textAlign: "center" },

  boardLink: {
    marginTop: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  boardLinkText: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
});
