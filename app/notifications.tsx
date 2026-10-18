import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import {
  getNotifications,
  markRead as apiMarkRead,
  markAllRead as apiMarkAllRead,
  Notification,
} from "@/services/notifications";

type Meta = {
  icon?: keyof typeof Feather.glyphMap;
  art?: any;
  tone: "accent" | "danger";
  /**
   * Set weight as well as colour.
   *
   * A notice from us is not another receipt in the pile - it is the one row in
   * the list nobody else generated, and it usually asks the reader to do or
   * know something. It carries the bell and it is set bold through, body
   * included, so it reads as an announcement rather than as another line of
   * history.
   */
  emphatic?: boolean;
};

/**
 * The mark for a notice, chosen from its content.
 *
 * Type alone is too coarse - every transaction notice shares one - so the text
 * decides. The mark is the only category signal on the row now: money moving
 * gets a direction, an announcement gets a bell, and anything that went wrong
 * goes red. A label saying the same thing in words would be the third time the
 * row said it.
 */
const FAILED = /\b(failed|declined|reversed|refunded)\b/;

function metaFor(n: { type: string; title: string; body?: string }): Meta {
  const t = `${n.title} ${n.body || ""}`.toLowerCase();

  if (n.type === "security") {
    if (/identity verified|verification (complete|successful)/i.test(n.title)) {
      return { art: require("@/assets/images/id-card.png"), tone: "accent" };
    }
    if (/verification unsuccessful|could ?n.t verify/i.test(n.title)) {
      return { art: require("@/assets/images/id-card.png"), tone: "danger" };
    }
    return { icon: "shield", tone: "danger" };
  }

  if (n.type === "savings") return { icon: "lock", tone: "accent" };
  if (n.type === "business_link" || n.type === "business_payment") return { icon: "briefcase", tone: "accent" };

  if (n.type === "transaction") {
    /**
     * The mark says what it was; the colour says how it went.
     *
     * Failure used to replace the mark with a warning glyph, which made a
     * failed payout and a failed airtime look like each other rather than
     * like the things they were - and the row already says "failed" in words
     * and turns red, so the glyph was the third time it said so. The mark is
     * chosen from the subject alone now and the tone is laid over it.
     *
     * The app's own artwork where it exists: the same marks people tapped to
     * start these things.
     */
    const tone: Meta["tone"] = FAILED.test(t) ? "danger" : "accent";

    // A voucher, before "claimed" can be read as anything else. It is a
    // reward rather than money arriving, and the deposit mark below would
    // file it with every other credit.
    if (t.includes("voucher")) {
      return { art: require("@/assets/images/gift-card.png"), tone };
    }

    // A swap is not a transfer out - nothing left the person, it only
    // gathered. Its own mark, before the send check can claim it.
    //
    // Both words are still matched. The notification says "Swapped" now, but
    // the ones already sitting in somebody's list say "Swept" and will for as
    // long as they keep them.
    if (t.includes("swap") || t.includes("swept") || t.includes("sweep")) {
      return { art: require("@/assets/images/swap.png"), tone };
    }

    // Airtime and data share the phone: one provider call, one mark.
    if (t.includes("airtime") || t.includes("data")) {
      return { art: require("@/assets/images/telephone-call.png"), tone };
    }
    if (t.includes("electricity") || t.includes("power") || t.includes("meter")) {
      return { art: require("@/assets/images/flash.png"), tone };
    }
    if (t.includes("tv") || t.includes("cable")) return { icon: "tv", tone };

    // Money arriving.
    if (t.includes("received") || t.includes("credit") || t.includes("deposit")) {
      return { art: require("@/assets/images/deposit.png"), tone };
    }

    // A business paid from the wallet - a shop's poster, a payment link, an invoice: the shop, not a send.
    if (t.startsWith("paid ") || t.includes("you paid") || t.startsWith("settlement from")) {
      return { art: require("@/assets/images/store.png"), tone };
    }

    // Money leaving, by any route - a bank payout, a wallet, a username.
    if (
      t.includes("sent") ||
      t.includes("transfer") ||
      t.includes("withdraw") ||
      t.includes("payout") ||
      t.includes("sold") ||
      t.includes("sell")
    ) {
      return { art: require("@/assets/images/send.png"), tone };
    }

    return { icon: "repeat", tone };
  }

  // Everything we send ourselves, and anything unrecognised, which is close
  // enough to the same thing: it came from us rather than from a transaction.
  return { art: require("@/assets/images/bell.png"), tone: "accent", emphatic: true };
}

const DAY = 86_400_000;

/** "Today" / "Yesterday" / "Sat, 9 Sep" - the date lives on the group, not the row. */
function dayLabel(d: Date): string {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const diff = midnight.getTime() - new Date(d).setHours(0, 0, 0, 0);
  if (diff <= 0) return "Today";
  if (diff <= DAY) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
}

const timeLabel = (d: Date) =>
  d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

/**
 * The last list fetched, kept outside the component.
 *
 * This screen is a stack route, so leaving it unmounts it and coming back
 * starts from empty - which meant a spinner on every single visit, for data
 * that had not changed since a moment ago. Seeding from the last result renders
 * the list immediately and lets the refresh land behind it.
 *
 * Module-level rather than context: nothing else needs it, and it should not
 * outlive the app session.
 */
let cachedNotifs: Notification[] = [];

export default function NotificationsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [notifs, setNotifs] = useState<Notification[]>(cachedNotifs);
  // Only the first load in a session blocks. After that there is always
  // something on screen to refresh behind.
  const [loading, setLoading] = useState(cachedNotifs.length === 0);
  const [tab, setTab] = useState<"all" | "unread">("all");
  /**
   * The notice opened to its full text, if any.
   *
   * The list clips a title to one line and the body to two, which is right
   * for scanning and wrong for reading - and tapping only marked it read, so
   * the rest of a long message could not be seen anywhere. A tap now opens
   * it in place; a second folds it back.
   */
  const [openId, setOpenId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getNotifications()
        .then((all) => {
          const next = all.slice(0, 50);
          cachedNotifs = next;
          setNotifs(next);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [])
  );

  const unreadCount = notifs.filter((n) => !n.read).length;

  /**
   * Grouped by day, in order.
   *
   * This is what removes the third line from every row: with the date stated
   * once at the top of a run, each notice only has to carry its time. It also
   * gives the list a rhythm, so a long history reads as days rather than as one
   * unbroken column.
   */
  const groups = useMemo(() => {
    /**
     * Sorted before grouping, always.
     *
     * The grouper only merges consecutive runs, so anything out of order splits
     * its day in two - which showed as TODAY appearing twice once the dev
     * stand-ins were prepended to a list that was already newest-first.
     */
    // The one being read stays put on the Unread tab: opening it marks it
    // read, and dropping it there and then would close it before it is read.
    const list = (tab === "unread" ? notifs.filter((n) => !n.read || n.id === openId) : notifs)
      .slice()
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    const out: { label: string; items: Notification[] }[] = [];
    for (const n of list) {
      const label = dayLabel(new Date(n.createdAt));
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [notifs, tab, openId]);

  // Both write through to the cache, so a row does not come back unread when
  // the screen is reopened before the server has been asked again.
  const handleMarkAllRead = async () => {
    cachedNotifs = cachedNotifs.map((n) => ({ ...n, read: true }));
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    apiMarkAllRead().catch(() => {});
  };

  const handleMarkRead = async (id: string) => {
    cachedNotifs = cachedNotifs.map((n) => (n.id === id ? { ...n, read: true } : n));
    setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    apiMarkRead(id).catch(() => {});
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Left-aligned, large. A centred title with symmetric chrome is the look
          of a screen that has nothing to say; this one is a destination. */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={() => router.push("/account/notifications-settings" as any)}
          hitSlop={12}
        >
          <Feather name="sliders" size={20} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <View style={styles.titleBlock}>
        <Text style={[styles.title, { color: colors.foreground }]}>Notifications</Text>
      </View>

      {/* Underline rather than pills: two states do not need two buttons, and a
          moving underline says "these are views of one list". */}
      <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
        {(["all", "unread"] as const).map((t) => {
          const active = tab === t;
          return (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              activeOpacity={0.7}
              style={styles.tab}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: active ? colors.foreground : colors.mutedForeground },
                ]}
              >
                {t === "all" ? "All" : "Unread"}
                {t === "unread" && unreadCount > 0 ? ` ${unreadCount}` : ""}
              </Text>
              {active && <View style={[styles.tabRule, { backgroundColor: colors.primary }]} />}
            </TouchableOpacity>
          );
        })}
        <View style={{ flex: 1 }} />
        {unreadCount > 0 && (
          <TouchableOpacity onPress={handleMarkAllRead} hitSlop={10} style={styles.tab}>
            <Text style={[styles.markAll, { color: colors.primary }]}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {tab === "unread" ? "Nothing unread" : "No notifications"}
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {tab === "unread"
              ? "Everything here has been read."
              : "Activity, security alerts and product news land here."}
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
          {groups.map((group) => (
            <View key={group.label}>
              <Text style={[styles.dayLabel, { color: colors.mutedForeground }]}>
                {group.label}
              </Text>

              {group.items.map((n, i) => {
                const meta = metaFor(n);
                const tone = meta.tone === "danger" ? colors.destructive : colors.primary;
                const d = new Date(n.createdAt);
                return (
                  <View key={n.id}>
                    {i > 0 && <View style={[styles.sep, { backgroundColor: colors.border }]} />}
                    <TouchableOpacity
                      style={styles.row}
                      onPress={() => {
                        handleMarkRead(n.id);
                        // A business asking to be linked: open where it's answered.
                        if (n.type === "business_link") return router.push("/account/linked-businesses" as any);
                        if (n.type === "business_payment") return router.push("/business-pay" as any);
                        setOpenId((cur) => (cur === n.id ? null : n.id));
                      }}
                      accessibilityState={{ expanded: openId === n.id }}
                      activeOpacity={0.7}
                    >
                      {/* Read notices recede instead of unread ones being
                          flagged. A read row goes uniformly muted - title, mark
                          and all - so an unread one is the only thing on screen
                          with a bright line in it. Nothing extra is drawn, and
                          the distinction survives a glance down the column. */}
                      <View
                        style={[
                          styles.mark,
                          { backgroundColor: tone + (n.read ? "0F" : "1A") },
                          n.read && styles.markRead,
                        ]}
                      >
                        {meta.art ? (
                          <Image source={meta.art} style={[styles.markArt, { tintColor: tone }]} />
                        ) : (
                          <Feather name={meta.icon!} size={16} color={tone} />
                        )}
                      </View>

                      <View style={styles.body}>
                        {/* Time on the title line, so a notice is two lines
                            rather than three. */}
                        <View style={styles.headline}>
                          <Text
                            style={[
                              styles.notifTitle,
                              { color: n.read ? colors.mutedForeground : colors.foreground },
                              // Weight survives being read; only the colour fades.
                              n.read && !meta.emphatic && styles.titleRead,
                              meta.emphatic && styles.titleLoud,
                            ]}
                            numberOfLines={openId === n.id ? undefined : 1}
                          >
                            {n.title}
                          </Text>
                          <Text style={[styles.time, { color: colors.mutedForeground }]}>
                            {timeLabel(d)}
                          </Text>
                        </View>

                        {!!n.body && (
                          <Text
                            style={[
                              styles.notifText,
                              { color: colors.mutedForeground },
                              meta.emphatic && [
                                styles.textLoud,
                                { color: n.read ? colors.mutedForeground : colors.foreground },
                              ],
                            ]}
                            numberOfLines={openId === n.id ? undefined : 2}
                          >
                            {n.body}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 10,
  },
  titleBlock: { paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontSize: 28, lineHeight: 34, fontFamily: "Inter_700Bold", letterSpacing: -0.8 },

  tabs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: { paddingVertical: 11 },
  tabText: { fontSize: 14, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  // Sits on the container's own border, so the active tab cuts through it.
  tabRule: { position: "absolute", left: 0, right: 0, bottom: -1, height: 2, borderRadius: 1 },
  markAll: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_600SemiBold" },

  dayLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 8,
  },

  row: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 20, paddingVertical: 13 },
  // A soft square, not a circle on a card. Small enough to sit beside the text
  // rather than announce itself.
  mark: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    flexShrink: 0,
  },
  markArt: { width: 17, height: 17, resizeMode: "contain" },
  markRead: { opacity: 0.55 },
  body: { flex: 1, gap: 3 },
  headline: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  notifTitle: { flex: 1, fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold", letterSpacing: -0.1 },
  titleRead: { fontFamily: "Inter_500Medium" },
  titleLoud: { fontFamily: "Inter_800ExtraBold", letterSpacing: -0.3 },
  textLoud: { fontFamily: "Inter_600SemiBold" },
  time: { fontSize: 11.5, lineHeight: 15, fontFamily: "Inter_400Regular" },
  notifText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  // Aligned to the text, not the screen, so the marks form a clean column.
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 64, opacity: 0.5 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 44, marginTop: -80 },
  emptyTitle: { fontSize: 17, lineHeight: 22, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular", textAlign: "center" },
});
