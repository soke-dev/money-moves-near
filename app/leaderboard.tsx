import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Image,
  Modal,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { Identicon } from "@/components/Identicon";
import { getServerUrl } from "@/services/api";
import {
  getPointsLeaderboard,
  getReferralsLeaderboard,
  getEventVolumeLeaderboard,
  getEventTradesLeaderboard,
  PointsLeaderboard,
  ReferralsLeaderboard,
  EventLeaderboard,
} from "@/services/leaderboard";

type Tab = "points" | "referrals" | "events";
type EventSubTab = "volume" | "trades";

/**
 * The trading competition, which has finished.
 *
 * Kept on the screen as a record rather than removed: people want to see where
 * they placed and who won. Everything about it is written in the past tense,
 * and nothing invites entry.
 */
const EVENT = {
  title: "Trading Competition",
  pot: "₦110K",
  ran: "24 May – 6 Jun 2026",
  closed: true,
};

const formatVolume = (v: number) => {
  if (v >= 1_000_000) return `₦${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `₦${(v / 1_000).toFixed(1)}k`;
  return `₦${v.toLocaleString()}`;
};

const displayRank = (rank: number | null) => {
  if (rank === null) return "—";
  if (rank > 99) return "99+";
  return String(rank);
};

/** Gold, silver, bronze - used as a thin ring, not a filled disc. */
const MEDAL = ["#E8B923", "#B8BCC4", "#C97B3C"];

/**
 * A name its owner has hidden.
 *
 * Drawn as a redaction rather than a blur. expo-blur is in the bundle and
 * would look better on iOS, but on Android it tints instead of blurring
 * unless `experimentalBlurMethod` is set - which would have meant the name
 * looked hidden on one platform and merely shaded on the other. A bar is the
 * same on both, and reads as deliberate rather than as a rendering fault.
 *
 * The rank, the figure and the picture all stay: the point is that you cannot
 * address this person, not that they are not here.
 */
function Hidden({
  colors,
  onExplain,
  width,
}: {
  colors: any;
  onExplain: () => void;
  width: number;
}) {
  return (
    <View style={s.hiddenRow}>
      <View style={[s.hiddenBar, { width, backgroundColor: colors.mutedForeground + "33" }]} />
      <TouchableOpacity onPress={onExplain} hitSlop={10} accessibilityLabel="Why is this hidden?">
        <Feather name="info" size={12} color={colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  );
}

export default function LeaderboardScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ initialTab?: string }>();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  /**
   * Asked for by tapping the mark beside a hidden name, so it explains the
   * thing that was just tapped rather than sitting on the page as a notice
   * nobody reads.
   *
   * A sheet rather than Alert.alert, which on these screens renders as a
   * stray fragment in the corner instead of a dialog.
   */
  const [showAnonInfo, setShowAnonInfo] = useState(false);
  const explainAnon = () => setShowAnonInfo(true);

  // Referrals can be asked for by name too: the referral dashboard links
  // straight to that tab rather than landing on points.
  const initialTab: Tab =
    params.initialTab === "events" ? "events" : params.initialTab === "referrals" ? "referrals" : "points";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [eventSubTab, setEventSubTab] = useState<EventSubTab>("volume");
  const [eventPage, setEventPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [pointsData, setPointsData] = useState<PointsLeaderboard | null>(null);
  const [referralsData, setReferralsData] = useState<ReferralsLeaderboard | null>(null);
  const [eventData, setEventData] = useState<EventLeaderboard | null>(null);

  useEffect(() => {
    setLoading(true);
    let fetcher: Promise<any>;
    if (tab === "points") fetcher = getPointsLeaderboard();
    else if (tab === "referrals") fetcher = getReferralsLeaderboard();
    else
      fetcher =
        eventSubTab === "volume"
          ? getEventVolumeLeaderboard(eventPage)
          : getEventTradesLeaderboard(eventPage);

    fetcher
      .then((data) => {
        if (tab === "points") setPointsData(data as PointsLeaderboard);
        else if (tab === "referrals") setReferralsData(data as ReferralsLeaderboard);
        else setEventData(data as EventLeaderboard);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tab, eventSubTab, eventPage]);

  /**
   * Referrals is back, now that sign-up takes a code again.
   *
   * It was hidden while there was no way to refer anyone, which left the
   * referral dashboard's link opening this board on a tab the bar did not
   * show - so neither visible tab was selected. It sits beside Points because
   * a referral is the other thing that moves you up.
   */
  const tabs: { key: Tab; label: string }[] = [
    { key: "points", label: "Points" },
    { key: "referrals", label: "Referrals" },
    { key: "events", label: "Events" },
  ];

  const eventPrimaryLabel = eventSubTab === "volume" ? "" : "trades";
  const formatEventValue = (v: number) =>
    eventSubTab === "volume" ? formatVolume(v) : v.toLocaleString();

  let topList: Array<{
    rank: number;
    name: string;
    anon: boolean;
    avatar: string | null;
    primary: string;
    primaryLabel: string;
  }> = [];
  if (tab === "points") {
    topList = (pointsData?.top || []).map((e) => ({
      rank: e.rank,
      name: e.name,
      anon: !!e.anon,
      avatar: e.avatar,
      primary: e.points.toLocaleString(),
      primaryLabel: "pts",
    }));
  } else if (tab === "referrals") {
    topList = (referralsData?.top || []).map((e) => ({
      rank: e.rank,
      name: e.name,
      anon: !!e.anon,
      avatar: e.avatar,
      primary: String(e.count),
      primaryLabel: "refs",
    }));
  } else {
    topList = (eventData?.top || []).map((e) => ({
      rank: e.rank,
      name: e.name,
      anon: !!e.anon,
      avatar: e.avatar,
      primary: formatEventValue(e.value),
      primaryLabel: eventPrimaryLabel,
    }));
  }

  const showPodium = tab !== "events" || eventPage === 1;
  const top3 = showPodium ? topList.slice(0, 3) : [];
  const rest = showPodium ? topList.slice(3) : topList;

  const myRank =
    tab === "points"
      ? pointsData?.me.rank ?? null
      : tab === "referrals"
        ? referralsData?.me.rank ?? null
        : eventData?.me.rank ?? null;
  const myAvatar =
    tab === "points"
      ? pointsData?.me.avatar ?? null
      : tab === "referrals"
        ? referralsData?.me.avatar ?? null
        : eventData?.me.avatar ?? null;
  const myName =
    tab === "points"
      ? pointsData?.me.name ?? "You"
      : tab === "referrals"
        ? referralsData?.me.name ?? "You"
        : eventData?.me.name ?? "You";
  const myPrimary =
    tab === "points"
      ? (pointsData?.me.points || 0).toLocaleString()
      : tab === "referrals"
        ? String(referralsData?.me.count || 0)
        : formatEventValue(eventData?.me.value || 0);
  const myLabel =
    tab === "points" ? "pts" : tab === "referrals" ? "refs" : eventPrimaryLabel;

  const avatarUri = (url: string | null | undefined) =>
    url ? (url.startsWith("http") || url.startsWith("data:") ? url : `${getServerUrl()}${url}`) : null;

  /**
   * One avatar, drawn the same way everywhere on this screen.
   *
   * Falls back to a generated identicon rather than an initial - and does the
   * same when a photo fails to load, which is why two rows on this board were
   * showing empty circles.
   */
  const Face = ({
    name,
    avatar,
    size,
    ring,
  }: {
    name: string;
    avatar: string | null;
    size: number;
    ring?: string;
  }) => {
    const uri = avatarUri(avatar);
    const [broken, setBroken] = useState(false);
    const showPhoto = !!uri && !broken;

    return (
      <View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            overflow: "hidden",
          },
          ring ? { borderWidth: 2, borderColor: ring } : null,
        ]}
      >
        {showPhoto ? (
          <Image
            source={{ uri: uri! }}
            style={{ width: "100%", height: "100%" }}
            onError={() => setBroken(true)}
          />
        ) : (
          <Identicon name={name} size={size} />
        )}
      </View>
    );
  };

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/referrals"))}
          hitSlop={10}
        >
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>Leaderboard</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* One control with two halves, not two buttons that happen to sit
          together. Two loose chips left it ambiguous which was selected and
          which was simply unpressed. */}
      <View style={[s.segment, { backgroundColor: colors.card }]}>
        {tabs.map((t) => {
          const on = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[s.segmentItem, on && { backgroundColor: colors.background }]}
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
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: bottomPad + 96 }}
          showsVerticalScrollIndicator={false}
        >
          {tab === "events" && (
            <>
              {/* The event as a record. It used to be a green gradient banner
                  with two glows and six medal emoji advertising prizes that
                  have already been paid. */}
              <View style={[s.eventCard, { backgroundColor: colors.card }]}>
                <View style={s.eventTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.eventTitle, { color: colors.foreground }]}>{EVENT.title}</Text>
                    <Text style={[s.eventDates, { color: colors.mutedForeground }]}>{EVENT.ran}</Text>
                  </View>
                  {EVENT.closed && (
                    <View style={[s.closedPill, { backgroundColor: colors.muted }]}>
                      <Text style={[s.closedText, { color: colors.mutedForeground }]}>Closed</Text>
                    </View>
                  )}
                </View>

                <View style={[s.eventPot, { borderTopColor: colors.border }]}>
                  <Text style={[s.eventPotLabel, { color: colors.mutedForeground }]}>
                    Prize pool paid out
                  </Text>
                  <Text style={[s.eventPotValue, { color: colors.foreground }]}>{EVENT.pot}</Text>
                </View>
              </View>

              <View style={[s.segment, s.subSegment, { backgroundColor: colors.card }]}>
                {([
                  { key: "volume" as EventSubTab, label: "Top movers" },
                  { key: "trades" as EventSubTab, label: "Most active" },
                ]).map((st) => {
                  const on = eventSubTab === st.key;
                  return (
                    <TouchableOpacity
                      key={st.key}
                      onPress={() => {
                        setEventSubTab(st.key);
                        setEventPage(1);
                      }}
                      style={[s.segmentItem, on && { backgroundColor: colors.background }]}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          s.segmentText,
                          { color: on ? colors.foreground : colors.mutedForeground },
                        ]}
                      >
                        {st.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {/* The top three, without the coloured blocks. Size and a medal ring
              carry the order; a bar chart of podium heights was decoration
              standing in for information already on the row. */}
          {top3.length > 0 && (
            <View style={s.podium}>
              {[1, 0, 2].map((slot) => {
                const e = top3[slot];
                const lead = slot === 0;
                if (!e) return <View key={slot} style={s.podiumSlot} />;
                return (
                  <View key={slot} style={[s.podiumSlot, lead && s.podiumLead]}>
                    <View>
                      <Face
                        name={e.name}
                        avatar={e.avatar}
                        size={lead ? 68 : 54}
                        ring={MEDAL[slot]}
                      />
                      <View style={[s.medal, { backgroundColor: MEDAL[slot], borderColor: colors.background }]}>
                        <Text style={s.medalText}>{e.rank}</Text>
                      </View>
                    </View>
                    {e.anon ? (
                      <Hidden colors={colors} onExplain={explainAnon} width={lead ? 64 : 54} />
                    ) : (
                      <Text
                        style={[s.podiumName, { color: colors.foreground }, lead && s.podiumNameLead]}
                        numberOfLines={1}
                      >
                        {e.name}
                      </Text>
                    )}
                    <Text style={[s.podiumValue, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {e.primary}
                      {e.primaryLabel ? ` ${e.primaryLabel}` : ""}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {rest.length > 0 && (
            <View style={[s.card, { backgroundColor: colors.card }]}>
              {rest.map((entry, i) => (
                <View
                  key={entry.rank}
                  style={[
                    s.row,
                    i < rest.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[s.rank, { color: colors.mutedForeground }]}>{entry.rank}</Text>
                  <Face name={entry.name} avatar={entry.avatar} size={34} />
                  {entry.anon ? (
                    <View style={s.nameSlot}>
                      <Hidden colors={colors} onExplain={explainAnon} width={78} />
                    </View>
                  ) : (
                    <Text style={[s.name, { color: colors.foreground }]} numberOfLines={1}>
                      {entry.name}
                    </Text>
                  )}
                  <Text style={[s.value, { color: colors.foreground }]}>
                    {entry.primary}
                    {entry.primaryLabel ? ` ${entry.primaryLabel}` : ""}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {topList.length === 0 && (
            <View style={s.center}>
              <Text style={[s.emptyTitle, { color: colors.foreground }]}>
                {tab === "events" ? "No entries recorded" : "Nobody on the board yet"}
              </Text>
              <Text style={[s.emptyText, { color: colors.mutedForeground }]}>
                {tab === "events"
                  ? "This competition closed without entries in this category."
                  : "Move some money and you will be the first."}
              </Text>
            </View>
          )}

          {tab === "events" && eventData && eventData.totalUsers > 0 && (
            <View style={s.pager}>
              <TouchableOpacity
                disabled={eventPage <= 1}
                onPress={() => setEventPage((p) => Math.max(1, p - 1))}
                style={[s.pagerBtn, { backgroundColor: colors.card, opacity: eventPage <= 1 ? 0.4 : 1 }]}
                activeOpacity={0.75}
              >
                <Feather name="chevron-left" size={16} color={colors.foreground} />
              </TouchableOpacity>

              <Text style={[s.pagerInfo, { color: colors.mutedForeground }]}>
                {Math.min(eventData.page * eventData.pageSize, eventData.totalUsers)} of{" "}
                {eventData.totalUsers}
              </Text>

              <TouchableOpacity
                disabled={!eventData.hasMore}
                onPress={() => setEventPage((p) => p + 1)}
                style={[s.pagerBtn, { backgroundColor: colors.card, opacity: eventData.hasMore ? 1 : 0.4 }]}
                activeOpacity={0.75}
              >
                <Feather name="chevron-right" size={16} color={colors.foreground} />
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}

      {/* Your line, pinned. Scrolling to find yourself is the one thing every
          leaderboard is used for. */}
      {!loading && (
        <View style={[s.youWrap, { paddingBottom: bottomPad + 14, backgroundColor: colors.background }]}>
          <View style={[s.youRow, { backgroundColor: colors.card, borderColor: colors.primary + "55" }]}>
            <Text style={[s.rank, { color: colors.primary }]}>{displayRank(myRank)}</Text>
            <Face name={myName} avatar={myAvatar} size={34} ring={colors.primary} />
            <Text style={[s.name, { color: colors.primary }]}>You</Text>
            <Text style={[s.value, { color: colors.foreground }]}>
              {myPrimary}
              {myLabel ? ` ${myLabel}` : ""}
            </Text>
          </View>
        </View>
      )}

      {/* Why a name is covered. */}
      <Modal visible={showAnonInfo} animationType="slide" transparent statusBarTranslucent>
        <TouchableOpacity
          style={s.sheetOverlay}
          activeOpacity={1}
          onPress={() => setShowAnonInfo(false)}
        >
          <View
            style={[s.sheetCard, { backgroundColor: colors.background, paddingBottom: bottomPad + 20 }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={s.sheetHandle} />
            <Text style={[s.sheetTitle, { color: colors.foreground }]}>Name hidden</Text>
            <Text style={[s.sheetBody, { color: colors.mutedForeground }]}>
              This person turned on anonymous mode, so their username is not
              shown here. Their rank and points are real and count the same as
              everybody else's.
            </Text>
            <Text style={[s.sheetBody, { color: colors.mutedForeground }]}>
              You can do the same under Account, then Security.
            </Text>
            <TouchableOpacity
              style={[s.sheetDone, { backgroundColor: colors.primary }]}
              onPress={() => setShowAnonInfo(false)}
              activeOpacity={0.85}
            >
              <Text style={[s.sheetDoneText, { color: colors.primaryForeground }]}>Got it</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheetCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#666",
    alignSelf: "center",
    marginBottom: 18,
  },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 12, letterSpacing: -0.2 },
  sheetBody: { fontSize: 14, lineHeight: 21, fontFamily: "Inter_400Regular", marginBottom: 14 },
  sheetDone: {
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  sheetDoneText: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },

  hiddenRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  // Sized like a short username rather than to the column, so it reads as a
  // name that is covered rather than as an empty field.
  hiddenBar: { height: 9, borderRadius: 5 },
  // The list row gives the name flex:1; the redaction needs the same slot or
  // the figure on the right slides left onto it.
  nameSlot: { flex: 1 },
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },

  segment: {
    flexDirection: "row",
    gap: 4,
    marginHorizontal: 16,
    marginBottom: 14,
    padding: 4,
    borderRadius: 14,
  },
  subSegment: { marginTop: 14, marginBottom: 0 },
  segmentItem: { flex: 1, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  segmentText: { fontSize: 13.5, lineHeight: 18, fontFamily: "Inter_600SemiBold" },

  eventCard: { marginHorizontal: 16, borderRadius: 20, paddingHorizontal: 16, paddingTop: 16 },
  eventTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  eventTitle: { fontSize: 16, lineHeight: 21, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  eventDates: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular", marginTop: 3 },
  closedPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  closedText: { fontSize: 11.5, lineHeight: 15, fontFamily: "Inter_600SemiBold" },
  eventPot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    paddingVertical: 13,
  },
  eventPotLabel: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_400Regular" },
  eventPotValue: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_700Bold" },

  podium: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 24,
  },
  podiumSlot: { flex: 1, alignItems: "center", gap: 8 },
  // The winner sits higher, which is the whole idea of a podium.
  podiumLead: { paddingBottom: 18 },
  medal: {
    position: "absolute",
    bottom: -4,
    alignSelf: "center",
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    left: 0,
    right: 0,
  },
  medalText: { fontSize: 11, lineHeight: 14, fontFamily: "Inter_800ExtraBold", color: "#0a0a0a" },
  podiumName: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold", maxWidth: "100%" },
  podiumNameLead: { fontSize: 14.5, lineHeight: 19, fontFamily: "Inter_700Bold" },
  podiumValue: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_500Medium" },

  card: { marginHorizontal: 16, borderRadius: 18, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  rank: { width: 24, fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  name: { flex: 1, fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  value: { fontSize: 14, lineHeight: 19, fontFamily: "Inter_700Bold" },

  pager: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 20 },
  pagerBtn: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  pagerInfo: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_500Medium" },

  center: { alignItems: "center", justifyContent: "center", paddingHorizontal: 40, paddingVertical: 70 },
  emptyTitle: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 5 },

  youWrap: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10 },
  youRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
