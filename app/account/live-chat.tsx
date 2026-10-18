import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
  Image,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import * as ImagePicker from "expo-image-picker";
import {
  ChatMessage,
  QuickOption,
  createConversation,
  getConversation,
  sendMessage,
  sendChatImage,
  pollMessages,
  resolveConversation,
  getChatImageUrl,
} from "@/services/chat";

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};


/**
 * Fold a batch into the list, whatever it says about it.
 *
 * Support can rewrite or withdraw a reply, so a batch is no longer only new
 * messages: it can carry one already on screen with different words, or one
 * that is gone. Matching on id makes all three the same operation, where
 * appending could only ever do the first.
 *
 * Sorted by createdAt, because that is when the message was said - an edited
 * reply belongs where it was written, not at the bottom.
 */
function mergeMessages(prev: ChatMessage[], batch: ChatMessage[]): ChatMessage[] {
  if (batch.length === 0) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of batch) {
    if (m.deleted) byId.delete(m.id);
    else byId.set(m.id, m);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

/** The newest change in a batch — where the next poll starts from. */
function newestChange(batch: ChatMessage[], fallback: string): string {
  let best = fallback ? new Date(fallback).getTime() : 0;
  let out = fallback;
  for (const m of batch) {
    const stamp = m.updatedAt || m.createdAt;
    const t = new Date(stamp).getTime();
    if (t > best) {
      best = t;
      out = stamp;
    }
  }
  return out;
}

export default function LiveChatScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [quickOptions, setQuickOptions] = useState<QuickOption[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [convoId, setConvoId] = useState<string | null>(params.conversationId || null);
  const [convoStatus, setConvoStatus] = useState<string>("OPEN");
  const [needsHuman, setNeedsHuman] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgTime = useRef<string>("");

  // Load or create conversation
  useEffect(() => {
    (async () => {
      try {
        if (params.conversationId) {
          const data = await getConversation(params.conversationId);
          setConvoId(data.conversation.id);
          setMessages(data.conversation.messages);
          setQuickOptions(data.conversation.quickOptions);
          setNeedsHuman(data.conversation.needsHuman);
          setConvoStatus(data.conversation.status);
          lastMsgTime.current = newestChange(data.conversation.messages, "");
        } else {
          const data = await createConversation();
          setConvoId(data.conversation.id);
          setMessages(data.conversation.messages);
          setQuickOptions(data.conversation.quickOptions);
        }
      } catch (err: any) {
        Alert.alert("Error", err.response?.data?.error || "Failed to load chat");
        router.back();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Poll for new messages (admin replies)
  useEffect(() => {
    if (!convoId || convoStatus === "RESOLVED") return;

    pollRef.current = setInterval(async () => {
      try {
        const data = await pollMessages(convoId, lastMsgTime.current);
        if (data.messages.length > 0) {
          lastMsgTime.current = newestChange(data.messages, lastMsgTime.current);
          setMessages((prev) => mergeMessages(prev, data.messages));
        }
        if (data.status === "RESOLVED") {
          setConvoStatus("RESOLVED");
        }
        setNeedsHuman(data.needsHuman);
      } catch {}
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [convoId, convoStatus]);

  // Auto scroll
  useEffect(() => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 150);
  }, [messages]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || !convoId || sending) return;
    Keyboard.dismiss();
    setInput("");
    setSending(true);

    try {
      const data = await sendMessage(convoId, { text: trimmed });
      setMessages((prev) => mergeMessages(prev, data.messages));
      lastMsgTime.current = newestChange(data.messages, lastMsgTime.current);
      setNeedsHuman(data.needsHuman);
      setQuickOptions(data.quickOptions);
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error || "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [input, convoId, sending]);

  const handleQuickOption = useCallback(
    async (option: QuickOption) => {
      if (!convoId || sending) return;
      setSending(true);
      try {
        const data = await sendMessage(convoId, { quickOption: option.value });
        setMessages((prev) => mergeMessages(prev, data.messages));
        lastMsgTime.current = newestChange(data.messages, lastMsgTime.current);
        setNeedsHuman(data.needsHuman);
        setQuickOptions(data.quickOptions);
      } catch (err: any) {
        Alert.alert("Error", err.response?.data?.error || "Failed to send");
      } finally {
        setSending(false);
      }
    },
    [convoId, sending]
  );

  const handleAttach = () => {
    Alert.alert("Send Image", "Choose a source", [
      { text: "Camera", onPress: takePhoto },
      { text: "Photo Library", onPress: pickImage },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow access to your photo library.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) sendImage(result.assets[0].uri);
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow camera access.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets[0]) sendImage(result.assets[0].uri);
  };

  const sendImage = async (uri: string) => {
    if (!convoId) return;
    setSending(true);
    try {
      const data = await sendChatImage(convoId, uri, input.trim() || undefined);
      setMessages((prev) => mergeMessages(prev, [data.message]));
      lastMsgTime.current = data.message.createdAt;
      setInput("");
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error || "Failed to send image");
    } finally {
      setSending(false);
    }
  };

  const handleResolve = () => {
    Alert.alert("End Conversation", "Mark this conversation as resolved?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Resolve",
        onPress: async () => {
          if (!convoId) return;
          try {
            await resolveConversation(convoId);
            setConvoStatus("RESOLVED");
          } catch {}
        },
      },
    ]);
  };

  /**
   * One message, aware of its neighbours.
   *
   * Messages from one sender are grouped: who it is and when they said it sit
   * on a single line above the run, and the bubbles below share a left edge.
   * An avatar in a side column pushed every bubble inward and left the mark
   * stranded under the last one, which is what made the column look crooked.
   */
  const renderMsg = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isUser = item.sender === "USER";
    const isAdmin = item.sender === "ADMIN";
    const prev = messages[index - 1];
    const next = messages[index + 1];
    const startsRun = !prev || prev.sender !== item.sender;
    const endsRun = !next || next.sender !== item.sender;

    return (
      <View style={[s.run, { marginTop: startsRun ? 16 : 3 }]}>
        {startsRun && (
          <View style={[s.meta, isUser && s.metaRight]}>
            {!isUser &&
              (isAdmin ? (
                <View style={[s.avatar, { backgroundColor: colors.muted }]}>
                  <Image
                    source={require("@/assets/images/support.png")}
                    style={[s.avatarMark, { tintColor: colors.mutedForeground }]}
                    resizeMode="contain"
                  />
                </View>
              ) : (
                /* The brand mark for the assistant: it is us answering. */
                <Image
                  source={require("@/assets/images/logo-badge.png")}
                  style={s.avatar}
                  resizeMode="contain"
                />
              ))}
            {!isUser && (
              <Text style={[s.sender, { color: colors.foreground }]}>
                {isAdmin ? "Support agent" : "Money Moves"}
              </Text>
            )}
            <Text style={[s.time, { color: colors.mutedForeground }]}>
              {formatTime(item.createdAt)}
            </Text>
          </View>
        )}

        <View style={[s.bubbleRow, isUser && s.bubbleRowRight]}>
          <View
            style={[
              s.bubble,
              isUser
                ? { backgroundColor: colors.primary, borderBottomRightRadius: endsRun ? 6 : 18 }
                : { backgroundColor: colors.card, borderBottomLeftRadius: endsRun ? 6 : 18 },
              !!item.imageUrl && s.bubbleImage,
            ]}
          >
            {!!item.imageUrl && (
              <Image
                source={{
                  uri:
                    item.imageUrl.startsWith("http") || item.imageUrl.startsWith("file")
                      ? item.imageUrl
                      : getChatImageUrl(item.imageUrl),
                }}
                style={s.msgImage}
                resizeMode="cover"
              />
            )}
            {!!item.text && (
              <Text
                style={[
                  s.bubbleText,
                  { color: isUser ? colors.primaryForeground : colors.foreground },
                  !!item.imageUrl && { paddingHorizontal: 10, paddingBottom: 8, paddingTop: 8 },
                ]}
              >
                {item.text}
              </Text>
            )}
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[s.container, s.center, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Header */}
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={[s.headerTitle, { color: colors.foreground }]}>Support</Text>
          <View style={s.onlineRow}>
            <View
              style={[
                s.onlineDot,
                { backgroundColor: convoStatus === "RESOLVED" ? colors.mutedForeground : colors.primary },
              ]}
            />
            <Text style={[s.onlineText, { color: colors.mutedForeground }]}>
              {convoStatus === "RESOLVED"
                ? "Resolved"
                : needsHuman
                  ? "Agent connected"
                  : "Usually replies instantly"}
            </Text>
          </View>
        </View>
        {/* Named, not a glyph: a bare tick in a chat header could mean sent,
            read or done. */}
        {convoStatus === "OPEN" ? (
          <TouchableOpacity
            style={[s.resolveBtn, { backgroundColor: colors.muted }]}
            onPress={handleResolve}
            activeOpacity={0.75}
            hitSlop={8}
          >
            <Feather name="check" size={13} color={colors.foreground} />
            <Text style={[s.resolveText, { color: colors.foreground }]}>Resolve</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      {/* Pinned, not spoken. The one thing worth saying on a support screen
          is that support will never ask for your keys, and a bubble carrying
          it disappears the moment the conversation starts. */}
      <View style={[s.safety, { backgroundColor: colors.card }]}>
        <Image
          source={require("@/assets/images/lock (1).png")}
          style={[s.safetyMark, { tintColor: colors.mutedForeground }]}
          resizeMode="contain"
        />
        <Text style={[s.safetyText, { color: colors.mutedForeground }]}>
          We will never ask for your recovery phrase, private keys or PIN.
        </Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderMsg}
          style={s.list}
          contentContainerStyle={[s.chatContent, { paddingBottom: 8 }]}
          showsVerticalScrollIndicator={false}
        />

        {/* Reaching a person is pinned to the left, outside the scroll: as the
            last chip in a scrolling row it sat off the right edge, so the one
            action someone hunts for was the one they could not see. */}
        {convoStatus === "OPEN" && (quickOptions.length > 0 || !needsHuman) && (
          <View style={s.quickBar}>
            {!needsHuman && (
              <TouchableOpacity
                style={[s.chip, s.chipPinned, { backgroundColor: colors.primary + "1F" }]}
                onPress={() =>
                  handleQuickOption({ label: "Talk to a person", value: "connect_human" })
                }
                disabled={sending}
                activeOpacity={0.75}
              >
                <Feather name="headphones" size={13} color={colors.primary} />
                <Text style={[s.chipText, { color: colors.primary }]}>Talk to a person</Text>
              </TouchableOpacity>
            )}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.quickRow}
              keyboardShouldPersistTaps="handled"
            >
              {quickOptions
                .filter((o) => o.value !== "connect_human")
                .map((o) => (
                  <TouchableOpacity
                    key={o.value}
                    style={[s.chip, { backgroundColor: colors.card }]}
                    onPress={() => handleQuickOption(o)}
                    disabled={sending}
                    activeOpacity={0.75}
                  >
                    <Text style={[s.chipText, { color: colors.foreground }]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>
          </View>
        )}

        {/* Input bar */}
        {convoStatus === "OPEN" ? (
          <View style={[s.composer, { paddingBottom: bottomPad + 10 }]}>
            {/* Attach, field and send in one pill, rather than three separate
                circles with the field boxed between them. */}
            <View style={[s.composerPill, { backgroundColor: colors.card }]}>
              <TouchableOpacity onPress={handleAttach} disabled={sending} hitSlop={8} style={s.attachBtn}>
                <Feather name="plus" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>

              <TextInput
                style={[s.input, { color: colors.foreground }]}
                placeholder="Message"
                placeholderTextColor={colors.mutedForeground}
                value={input}
                onChangeText={setInput}
                multiline
                maxLength={1000}
                returnKeyType="send"
                onSubmitEditing={handleSend}
                blurOnSubmit
                editable={!sending}
              />

              <TouchableOpacity
                style={[
                  s.sendBtn,
                  { backgroundColor: input.trim() && !sending ? colors.primary : colors.muted },
                ]}
                onPress={handleSend}
                disabled={!input.trim() || sending}
                activeOpacity={0.85}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                ) : (
                  <Feather
                    name="arrow-up"
                    size={17}
                    color={input.trim() ? colors.primaryForeground : colors.mutedForeground}
                  />
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={[s.resolvedBar, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: bottomPad + 8 }]}>
            <Feather name="check-circle" size={16} color="#22c55e" />
            <Text style={[s.resolvedText, { color: colors.mutedForeground }]}>This conversation has been resolved</Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCenter: { alignItems: "center" },
  headerTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  onlineRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  onlineDot: { width: 6, height: 6, borderRadius: 3 },
  onlineText: { fontSize: 11, fontFamily: "Inter_400Regular" },

  safety: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  safetyMark: { width: 14, height: 14 },
  safetyText: { flex: 1, fontSize: 11.5, lineHeight: 16, fontFamily: "Inter_400Regular" },

  list: { flex: 1 },
  // No gap: each message sets its own top margin, tight within a run and
  // open between them.
  chatContent: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 },

  run: { alignSelf: "stretch" },
  // Who and when, on one line above the run.
  meta: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6, marginLeft: 2 },
  metaRight: { justifyContent: "flex-end", marginRight: 2 },
  avatar: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  avatarMark: { width: 10, height: 10 },
  sender: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_600SemiBold" },
  time: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_400Regular" },

  bubbleRow: { flexDirection: "row" },
  bubbleRowRight: { justifyContent: "flex-end" },
  bubble: { maxWidth: "86%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleImage: { padding: 4 },
  bubbleText: { fontSize: 14.5, lineHeight: 21, fontFamily: "Inter_400Regular" },
  msgImage: { width: 210, height: 158, borderRadius: 15 },

  resolveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 30,
    paddingHorizontal: 11,
    borderRadius: 10,
  },
  resolveText: { fontSize: 12.5, lineHeight: 17, fontFamily: "Inter_600SemiBold" },

  quickBar: {
    flexGrow: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    paddingTop: 6,
    paddingBottom: 8,
  },
  chipPinned: { marginRight: 8 },
  quickRow: { paddingRight: 16, gap: 8, alignItems: "center" },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    height: 36, paddingHorizontal: 14, borderRadius: 12, justifyContent: "center",
  },
  chipText: { fontSize: 13, lineHeight: 17, fontFamily: "Inter_500Medium" },

  composer: { paddingHorizontal: 16, paddingTop: 2 },
  composerPill: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderRadius: 24,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
  },
  attachBtn: { height: 36, justifyContent: "center" },
  input: {
    flex: 1,
    fontSize: 14.5,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    paddingTop: Platform.OS === "ios" ? 9 : 6,
    paddingBottom: Platform.OS === "ios" ? 9 : 6,
    maxHeight: 110,
  },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },

  resolvedBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 16, borderTopWidth: StyleSheet.hairlineWidth,
  },
  resolvedText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
