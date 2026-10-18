import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  LayoutAnimation,
  Image,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";



const FAQS: { q: string; a: string }[] = [
  {
    q: "What is Money Moves?",
    a: "A finance app where you hold the money yourself. You keep a balance in stablecoins and spend it at home: pay bills, send to any bank, buy airtime and data, all from one balance.",
  },
  {
    q: "How do I sign in?",
    a: "With your email address. We send a code to your inbox each time you sign in, so there is no password to remember or lose. Once you are in, your PIN and biometrics protect the app on this device.",
  },
  {
    q: "What cryptocurrencies are supported?",
    a: "USDC, USDT and MOVE. USDC and USDT move on Movement, Base, BNB Smart Chain and Solana; MOVE is on Movement. Bitcoin and USDT on Tron are on the way.",
  },
  {
    q: "How do I add money?",
    a: "Tap Add money on the home screen. Deposit crypto sends you an address and QR code to send to, and is free. Deposit fiat gives you a Flutterwave account number to transfer Naira to, which arrives as crypto in your wallet.",
  },
  {
    q: "How do I send Naira to a bank?",
    a: "Tap Send money, then Bank Transfer. Pick a saved account or add one, enter the amount and confirm. The Naira goes straight to the bank. The fee is 0.5% plus \u20A650 processing, and gas is on us.",
  },
  {
    q: "Can I send crypto to an external wallet?",
    a: "Yes. Send money, then Crypto Transfer. Enter or scan the address, pick the token, chain and amount, and confirm. No fee and no gas. This one needs your identity verified.",
  },
  {
    q: "Can I send to another Money Moves user?",
    a: "Yes. Send money, then Send to Username. Enter their username and the amount. It is instant, free, and has no limit, because it moves on chain between two wallets. Neither of you needs to be verified.",
  },
  {
    q: "What bills can I pay?",
    a: "Airtime and data for MTN, Airtel, Glo and 9mobile, and electricity for all the major discos on prepaid or postpaid meters. Cable TV is on the way.",
  },
  {
    q: "What are the transaction limits?",
    a: "They depend on whether you are verified. Basic covers bank transfers up to \u20A620,000 a day; verified raises that to \u20A62,000,000, unlocks funding with Naira up to \u20A6200,000 a day, unlocks betting up to ₦10,000 a day, and lifts the bills caps. Username and crypto transfers are unlimited. Account, then Transaction limits, shows both levels side by side with what you have used today.",
  },
  {
    q: "How do I get verified?",
    a: "Account, then Identity verification. Our verification partner asks for a valid government ID, a face match and a liveness check, and it usually takes a few minutes. Your documents go to them, not to us.",
  },
  {
    q: "How does Savings work?",
    a: "Lock USDC or USDT for 7 days, 30 days, 3 months, 6 months, or a length you choose, on any supported chain. A 0.5% lock fee applies and the funds stay locked until the unlock date. Track them in the Savings tab.",
  },
  {
    q: "Where are my keys kept?",
    a: "With you. The wallet is self-custodial: it is secured by multi-party computation, so no single party, us included, ever holds a whole key, and we cannot move your funds or freeze them. Take your own copy whenever you like at Account, Security, then Export wallet.",
  },
  {
    q: "Can I export my wallet?",
    a: "Yes. Account, Security, then Export wallet. After your PIN you can reveal two keys: one for Base and BNB, and one that covers Movement and Solana together. Movement writes that second key differently to Solana, so the app converts it for you on the spot.",
  },
  {
    q: "What are the fees?",
    a: "Deposits 0%. Crypto transfers 0% and gasless. Bank transfer 0.5% plus \u20A650. Funding with Naira 1%. Savings lock 0.5%. Airtime, data and electricity 0%. Every fee is shown before you confirm.",
  },
  {
    q: "How do I change my PIN?",
    a: "Account, then Security, then Change PIN. We email you a code first, then you choose a new 4-digit PIN. There is no password on the account to change.",
  },
  {
    q: "I forgot my PIN. What do I do?",
    a: "On the unlock screen tap \"Forgot PIN?\". A reset code goes to your email; enter it and set a new PIN.",
  },
  {
    q: "Can I see my balance in dollars?",
    a: "Yes. Account, then Currency display, and pick USD or NGN. It changes what you see, not what you hold or what anything is sent in.",
  },
  {
    q: "What banks are supported?",
    a: "Over 38 banks, including Access, GTBank, First Bank, UBA, Zenith, Kuda, OPay, PalmPay, Moniepoint and Carbon.",
  },
  {
    q: "How do I close my account?",
    a: "My Profile, then Request account deletion. A person reviews every request, and your account keeps working until it is closed. Move anything left in your wallet out first, or export your keys, because access ends with the account.",
  },
  {
    q: "How do I contact support?",
    a: "Account, then Help and support. Live chat is there around the clock, or email support@usemoneymoves.xyz. The help articles and FAQs answer most things without waiting.",
  },
];

/**
 * Questions by topic, rather than one list of twenty-one.
 *
 * The order within a topic is the order someone meets them: what the app is
 * before how to sign in, sending before limits.
 */
const GROUPS: { label: string; img: any; questions: string[] }[] = [
  {
    label: "GETTING STARTED",
    img: require("@/assets/images/home.png"),
    questions: [
      "What is Money Moves?",
      "How do I sign in?",
      "What cryptocurrencies are supported?",
      "How do I add money?",
    ],
  },
  {
    label: "MOVING MONEY",
    img: require("@/assets/images/send.png"),
    questions: [
      "How do I send Naira to a bank?",
      "Can I send crypto to an external wallet?",
      "Can I send to another Money Moves user?",
      "What bills can I pay?",
      "What banks are supported?",
      "How does Savings work?",
    ],
  },
  {
    label: "LIMITS AND FEES",
    img: require("@/assets/images/naira.png"),
    questions: [
      "What are the transaction limits?",
      "How do I get verified?",
      "What are the fees?",
    ],
  },
  {
    label: "SECURITY AND WALLET",
    img: require("@/assets/images/lock.png"),
    questions: [
      "Where are my keys kept?",
      "Can I export my wallet?",
      "How do I change my PIN?",
      "I forgot my PIN. What do I do?",
    ],
  },
  {
    label: "YOUR ACCOUNT",
    img: require("@/assets/images/user (2).png"),
    questions: [
      "Can I see my balance in dollars?",
      "How do I close my account?",
      "How do I contact support?",
    ],
  },
];

export default function FAQScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const toggle = (q: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeInEaseOut", "opacity"));
    setOpen((prev) => (prev === q ? null : q));
  };

  const answer = (q: string) => FAQS.find((f) => f.q === q)?.a ?? "";

  // Searching flattens the topics: when you are hunting for one word, the
  // grouping is in the way rather than helping.
  const hits = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return null;
    return FAQS.filter((f) => f.q.toLowerCase().includes(t) || f.a.toLowerCase().includes(t));
  }, [query]);

  const Row = ({ q, last }: { q: string; last: boolean }) => {
    const isOpen = open === q;
    return (
      <View style={!last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        <TouchableOpacity style={s.row} onPress={() => toggle(q)} activeOpacity={0.7}>
          <Text style={[s.q, { color: colors.foreground }]}>{q}</Text>
          <Feather
            name={isOpen ? "chevron-up" : "chevron-down"}
            size={17}
            color={colors.mutedForeground}
          />
        </TouchableOpacity>
        {isOpen && <Text style={[s.a, { color: colors.mutedForeground }]}>{answer(q)}</Text>}
      </View>
    );
  };

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>FAQs</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* A search field earns its place here: twenty-one questions is more
          than anyone reads top to bottom. */}
      <View style={[s.searchBox, { backgroundColor: colors.card }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[s.searchInput, { color: colors.foreground }]}
          placeholder="Search questions"
          placeholderTextColor={colors.mutedForeground}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery("")} hitSlop={8}>
            <Feather name="x" size={15} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad + 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {hits ? (
          hits.length === 0 ? (
            <View style={s.empty}>
              <Text style={[s.emptyTitle, { color: colors.foreground }]}>No answer for that</Text>
              <Text style={[s.emptyText, { color: colors.mutedForeground }]}>
                Try another word, or ask us directly.
              </Text>
            </View>
          ) : (
            <View style={[s.card, { backgroundColor: colors.card }]}>
              {hits.map((f, i) => (
                <Row key={f.q} q={f.q} last={i === hits.length - 1} />
              ))}
            </View>
          )
        ) : (
          GROUPS.map((group) => (
            <View key={group.label}>
              <View style={s.groupHead}>
                <Image
                  source={group.img}
                  style={[s.groupMark, { tintColor: colors.mutedForeground }]}
                  resizeMode="contain"
                />
                <Text style={[s.groupLabel, { color: colors.mutedForeground }]}>{group.label}</Text>
              </View>
              <View style={[s.card, { backgroundColor: colors.card }]}>
                {group.questions.map((q, i) => (
                  <Row key={q} q={q} last={i === group.questions.length - 1} />
                ))}
              </View>
            </View>
          ))
        )}

        {/* A row, not a bordered card with its own button. */}
        <TouchableOpacity
          style={[s.chatRow, { backgroundColor: colors.card }]}
          onPress={() => router.push("/account/live-chat")}
          activeOpacity={0.75}
        >
          <View style={[s.chatIcon, { backgroundColor: colors.muted }]}>
            <Image
              source={require("@/assets/images/customer-service.png")}
              style={[s.chatMark, { tintColor: colors.mutedForeground }]}
              resizeMode="contain"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.chatTitle, { color: colors.foreground }]}>Still stuck?</Text>
            <Text style={[s.chatSub, { color: colors.mutedForeground }]}>Chat with an agent</Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
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
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },

  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 9,
    marginHorizontal: 16, marginBottom: 4,
    borderRadius: 13, paddingHorizontal: 13, height: 44,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },

  groupHead: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 22, marginBottom: 8, marginLeft: 22 },
  groupMark: { width: 13, height: 13 },
  groupLabel: { fontSize: 10.5, lineHeight: 14, fontFamily: "Inter_700Bold", letterSpacing: 1.1 },

  card: { marginHorizontal: 16, borderRadius: 18, paddingHorizontal: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15 },
  q: { flex: 1, fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  a: { fontSize: 13.5, lineHeight: 21, fontFamily: "Inter_400Regular", paddingBottom: 16, paddingRight: 24 },

  empty: { alignItems: "center", paddingVertical: 60, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 15.5, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 5 },

  chatRow: {
    flexDirection: "row", alignItems: "center", gap: 13,
    marginHorizontal: 16, marginTop: 26,
    borderRadius: 18, paddingHorizontal: 14, paddingVertical: 13,
  },
  chatIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  chatMark: { width: 18, height: 18 },
  chatTitle: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  chatSub: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 1 },
});
