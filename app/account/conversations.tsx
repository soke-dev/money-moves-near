import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SectionList,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Image,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { ChatConversation, listConversations } from "@/services/chat";

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export default function ConversationsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await listConversations();
      setConversations(data);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  /**
   * Open first, finished underneath.
   *
   * The two were mixed by recency, so a resolved conversation could sit above
   * one still waiting on an answer. Each section is newest-first within itself.
   */
  const sections = useMemo(() => {
    const by = (a: ChatConversation, b: ChatConversation) =>
      +new Date(b.lastMessageAt || b.createdAt) - +new Date(a.lastMessageAt || a.createdAt);
    const open = conversations.filter((c) => c.status === "OPEN").sort(by);
    const done = conversations.filter((c) => c.status !== "OPEN").sort(by);

    return [
      ...(open.length ? [{ title: "OPEN", data: open }] : []),
      ...(done.length ? [{ title: "RESOLVED", data: done }] : []),
    ];
  }, [conversations]);

  const openCount = conversations.filter((c) => c.status === "OPEN").length;

  const renderItem = ({ item, index, section }: any) => {
    const isOpen = item.status === "OPEN";
    const first = index === 0;
    const last = index === section.data.length - 1;

    return (
      <TouchableOpacity
        style={[
          s.row,
          { backgroundColor: colors.card },
          first && s.rowFirst,
          last && s.rowLast,
          !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
        ]}
        activeOpacity={0.7}
        onPress={() =>
          router.push({ pathname: "/account/live-chat", params: { conversationId: item.id } })
        }
      >
        <View style={[s.mark, { backgroundColor: colors.muted }]}>
          <Image
            source={require("@/assets/images/customer-service.png")}
            style={[
              s.markImg,
              { tintColor: isOpen ? colors.primary : colors.mutedForeground },
              !isOpen && { opacity: 0.6 },
            ]}
            resizeMode="contain"
          />
        </View>

        {/* The message is the row. A title reading "Active Chat" above it said
            nothing the section header does not already say. */}
        <View style={s.rowText}>
          <Text
            style={[s.preview, { color: isOpen ? colors.foreground : colors.mutedForeground }]}
            numberOfLines={2}
          >
            {item.lastMessage || "No messages yet"}
          </Text>
          {item.needsHuman && isOpen && (
            <View style={s.agentRow}>
              <View style={[s.dot, { backgroundColor: colors.primary }]} />
              <Text style={[s.agentText, { color: colors.primary }]}>Agent connected</Text>
            </View>
          )}
        </View>

        <Text style={[s.time, { color: colors.mutedForeground }]}>
          {timeAgo(item.lastMessageAt || item.createdAt)}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>Conversations</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>{section.title}</Text>
          )}
          renderSectionFooter={() => <View style={s.sectionFoot} />}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={
            sections.length === 0
              ? { flexGrow: 1 }
              : { paddingBottom: bottomPad + 96, paddingTop: 4 }
          }
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={s.center}>
              <Text style={[s.emptyTitle, { color: colors.foreground }]}>Nothing here yet</Text>
              <Text style={[s.emptyText, { color: colors.mutedForeground }]}>
                Start a chat and it will show up here.
              </Text>
            </View>
          }
        />
      )}

      {/* A labelled pill rather than a bare circle: there is one thing to do on
          this screen and the word costs nothing. */}
      <TouchableOpacity
        style={[s.newBtn, { backgroundColor: colors.primary, bottom: bottomPad + 20 }]}
        activeOpacity={0.85}
        onPress={() => router.push("/account/live-chat")}
      >
        <Feather name="plus" size={17} color={colors.primaryForeground} />
        <Text style={[s.newBtnText, { color: colors.primaryForeground }]}>New chat</Text>
      </TouchableOpacity>

      {openCount >= 3 && (
        <Text style={[s.capNote, { color: colors.mutedForeground, bottom: bottomPad + 76 }]}>
          Three open chats is the limit. Resolve one to start another.
        </Text>
      )}
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
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, paddingBottom: 80 },
  emptyTitle: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 5 },

  sectionLabel: {
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.1,
    marginTop: 18,
    marginBottom: 8,
    marginLeft: 22,
  },
  // Closes the card the rows sit in, so the next section starts clear of it.
  sectionFoot: { height: 4 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowFirst: { borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  rowLast: { borderBottomLeftRadius: 18, borderBottomRightRadius: 18 },
  mark: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  markImg: { width: 18, height: 18 },
  rowText: { flex: 1, gap: 5 },
  preview: { fontSize: 13.5, lineHeight: 19, fontFamily: "Inter_400Regular" },
  agentRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  agentText: { fontSize: 11.5, lineHeight: 15, fontFamily: "Inter_600SemiBold" },
  time: { fontSize: 11.5, lineHeight: 15, fontFamily: "Inter_400Regular", alignSelf: "flex-start", marginTop: 2 },

  newBtn: {
    position: "absolute",
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  newBtnText: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold" },

  capNote: {
    position: "absolute",
    left: 20,
    right: 20,
    fontSize: 11.5,
    lineHeight: 16,
    fontFamily: "Inter_400Regular",
    textAlign: "right",
  },
});
