import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  LayoutAnimation,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface Article {
  img: any;
  title: string;
  desc: string;
  content: string;
}

const ARTICLES: Article[] = [
  {
    img: require("@/assets/images/home.png"),
    title: "Getting Started",
    desc: "Sign in, set your PIN, get verified, and make your first deposit.",
    content: `Welcome to Money Moves. Here is the short version:\n\n1. Sign in with your email\nThere is no password. We send a code to your inbox, you enter it, and you are in. The same thing happens on a new device.\n\n2. Set your PIN\nFour digits, used to unlock the app and to approve anything that moves money.\n\n3. Turn on biometrics (optional)\nFace or fingerprint instead of typing your PIN. Account, then Security.\n\n4. Your wallet\nOne is created for you the first time you sign in, across Movement, Base, Solana and BNB Smart Chain. It is self-custodial: secured by multi-party computation, so nobody, us included, ever holds a whole key, and nobody else can move or freeze what is in it.\n\nTake a copy anyway: Account, Security, then Export wallet. You will need your PIN and an emailed code.\n\n5. Get verified\nAccount, then Identity verification. A government ID, a face match and a liveness check, handled by our verification partner. It raises your limits and unlocks funding with Naira and crypto transfers.\n\n6. Add money\nTap Add money. Deposit crypto gives you an address and QR code. Deposit fiat gives you an account number to transfer Naira to, which lands as crypto.\n\n7. Spend it\nSend money covers bank transfers, crypto transfers and sending to another Money Moves username. Pay bills covers airtime, data and electricity.`,
  },
  {
    img: require("@/assets/images/transaction.png"),
    title: "Adding and cashing out",
    desc: "Step-by-step guide on buying crypto with Naira and selling crypto for Naira.",
    content: `How to Buy Crypto\n\n1. Tap Add money on the home screen, then Deposit fiat.\n2. Enter the Naira amount you want to spend.\n3. Select the token (USDC, USDT or MOVE) and the chain.\n4. Review the rate and the 1% fee.\n5. Transfer that amount from your bank to the account number shown.\n6. The crypto lands in your wallet once the transfer clears.\n\nNote: Buying crypto requires KYC verification. Daily limit: ₦200,000.\n\nHow to Sell Crypto\n\n1. Tap Sell on the home screen.\n2. Enter the amount or tap "Max" to sell your full balance.\n3. Select or add a bank account.\n4. Review the rate, 0.5% fee, and ₦50 processing fee.\n5. Confirm. Naira is sent to your bank account.\n\nThe app auto-selects your highest-value token. Sell transactions are gasless, you pay no network fees.`,
  },
  {
    img: require("@/assets/images/send.png"),
    title: "Sending money",
    desc: "Send Naira to banks, transfer to users, or withdraw crypto to external wallets.",
    content: `Bank Transfer (Sell to Bank)\n\nSend local fiat to any of 38+ banks including Access, GTBank, First Bank, UBA, Zenith, Kuda, OPay, PalmPay, Moniepoint, and more.\n\n1. Tap Sell > enter amount > select bank and account number.\n2. We verify the account name before you confirm.\n3. Naira arrives in your bank account. Gasless!\n\nMM Username Transfer\n\nSend crypto to another Money Moves user instantly and for free.\n\n1. Tap Transfer, enter the recipient's username.\n2. Enter the amount and confirm.\n3. Funds arrive instantly. No fees, no waiting.\n\nRequires KYC. Daily limit: ₦200,000.\n\nCrypto Withdrawal\n\nSend crypto to any external wallet address.\n\n1. Tap Withdraw, select token and chain.\n2. Enter or paste the recipient wallet address.\n3. Enter the amount and confirm.\n4. 0% fee, gasless. Requires KYC.`,
  },
  {
    img: require("@/assets/images/receipt.png"),
    title: "Bills and airtime",
    desc: "Buy airtime and data, and pay electricity, straight from your balance.",
    content: `Airtime and Data\n\nBuy airtime or data for MTN, Airtel, Glo, and 9Mobile.\n\n1. Tap Airtime on the home screen.\n2. Select the network and enter the phone number (or pick from contacts).\n3. Choose an amount (airtime) or select a data plan.\n4. Confirm. Delivered instantly.\n\nUnverified: ₦3,000/day, ₦1,000/tx. Verified: ₦10,000/day, ₦5,000/tx.\n\nElectricity\n\nPay for prepaid or postpaid meters across all major DISCOs including IKEDC, EKEDC, KEDCO, PHED, JED, IBEDC, KAEDCO, AEDC, EEDC, BEDC, ABEDC, and YEDC.\n\n1. Select your DISCO and meter type.\n2. Enter your meter number and we verify it.\n3. Enter the amount and confirm.\n\nCable TV\n\nSubscribe to DSTV, GOtv, or Startimes packages.\n\n1. Select your provider.\n2. Enter your Smart Card / IUC number.\n3. Choose a package and confirm.\n\nAll bill payments have 0% fees.`,
  },
  {
    img: require("@/assets/images/piggy-bank.png"),
    title: "Savings",
    desc: "Lock your USDC or USDT for a fixed period and save securely on-chain.",
    content: `How Savings Works\n\nLock USDC or USDT on any supported chain (Movement, Base, Solana, or BNB Smart Chain) for a fixed duration.\n\nAvailable Lock Periods:\n• 7 days\n• 30 days\n• 3 months\n• 6 months\n• 1 year\n\nHow to Save:\n1. Go to the Savings tab.\n2. Tap "Create Savings" and select a token and chain.\n3. Enter the amount and choose a lock duration.\n4. Review the 0.5% lock fee and confirm.\n\nImportant:\n• Funds cannot be withdrawn before the unlock date.\n• Track active and completed savings in the Savings tab with progress bars.\n• Savings sit on chain in your own wallet the whole time.`,
  },
  {
    img: require("@/assets/images/lock.png"),
    title: "Security",
    desc: "PIN, biometrics, how sign-in works, and keeping your keys safe.",
    content: `Signing in\n\nYour email is the account. We send a one-time code each time you sign in, so there is no password to guess, reuse or leak.\n\nYour PIN\n\nFour digits, asked for when you open the app and before anything that moves money. Never share it. Change it at Account, Security, Change PIN: we email a code first, then you pick the new one.\n\nForgot your PIN?\n\nTap \"Forgot PIN?\" on the unlock screen. A reset code goes to your email.\n\nBiometrics\n\nAccount, then Security. Two separate switches: one to unlock the app, one to approve payments. Either can be on without the other.\n\nYour keys\n\nYour keys, your coins. The wallet is self-custodial, secured with multi-party computation: no single party holds a complete key, the app never sees one, and nobody but you can move what is in it.\n\nExporting your wallet\n\nAccount, Security, then Export wallet. Your PIN, then an emailed verification, then you can reveal two keys: one for Base and BNB, and one covering Movement and Solana. Anyone with those keys controls that wallet, so keep them somewhere only you can reach, and clear your clipboard afterwards.\n\nGood habits\n\n\u2022 Turn biometrics on\n\u2022 Export your keys and store them offline\n\u2022 Never share your PIN, your keys or an emailed code, including with anyone claiming to be us\n\u2022 Keep the app updated`,
  },
  {
    img: require("@/assets/images/id-card.png"),
    title: "Identity verification",
    desc: "What verification unlocks, what you need, and how it works.",
    content: `Why verify?\n\nVerification raises every limit and unlocks two features:\n\n\u2022 Bank transfers: \u20A620,000 a day up to \u20A62,000,000\n\u2022 Funding with Naira: locked, up to \u20A6200,000 a day\n\u2022 Crypto transfers: no limit either way\n\u2022 Airtime and data: \u20A63,000 a day up to \u20A610,000\n\u2022 Electricity: \u20A65,000 a day up to \u20A620,000\n\u2022 Betting: locked, up to \u20A610,000 a day\n\nSending crypto to an address or to another Money Moves username needs no verification and has no limit, because it moves on chain out of a wallet only you hold the keys to.\n\nWhat you need\n\n\u2022 A valid government ID\n\u2022 Your face, for a match against the ID and a liveness check\n\nHow it works\n\n1. Account, then Identity verification.\n2. You are handed to our verification partner, who runs the checks and holds the documents. They do not come to us.\n3. Most results land within minutes. You will get a notification either way.\n\nIf it fails\n\nUsually the photo: glare, a cropped corner, or a document too worn to read. Try again in better light with all four corners in frame. If it keeps failing, contact support.`,
  },
  {
    img: require("@/assets/images/naira.png"),
    title: "Rates and fees",
    desc: "How exchange rates work and a complete breakdown of all fees.",
    content: `Exchange Rates\n\nMoney Moves offers real-time exchange rates that update continuously. Check live rates for all supported tokens on the Rates tab. Rates refresh every 2 minutes.\n\n• Sell rate: What you get when selling crypto for Naira\n• Buy (Fund) rate: What you pay when buying crypto with Naira\n• 24 hour change percentage is displayed for each token\n\nFee Breakdown:\n\n• Deposit crypto: 0% (Free)\n• Sell to bank: 0.5% + ₦50 processing\n• Buy crypto: 1%\n• Crypto withdrawal: 0% (Gasless)\n• MM username transfer: 0% (Free)\n• Savings lock: 0.5%\n• Airtime and data: 0% (Free)\n• Electricity: 0% (Free)\n• Cable TV: 0% (Free)\n\nAll fees are shown clearly on the confirmation screen before you approve any transaction. No hidden charges.`,
  },
  {
    img: require("@/assets/images/support.png"),
    title: "Troubleshooting",
    desc: "Solutions for failed transactions, pending deposits, login issues, and more.",
    content: `Deposit Not Showing\n\n• Crypto deposits require blockchain confirmations. Wait a few minutes and refresh.\n• Make sure you sent to the correct wallet address and chain. Sending to the wrong chain may result in lost funds.\n• Check the Transactions tab for status updates.\n\nBank Transfer Pending\n\n• Bank transfers usually complete within minutes, but can take up to 24 hours during bank maintenance.\n• If still pending after 24 hours, contact support with your transaction ID.\n\nTransaction Failed\n\n• Check your balance, you may not have enough to cover the amount.\n• Ensure your KYC is verified for features that require it.\n• Check if you've hit your daily limit (Account > Transaction limits).\n\nCan't Sign In\n\n• Check the email address, then look for the code we sent - it can land in spam.\n• Codes expire, so ask for a new one rather than reusing an old email.\n• If your account is locked, wait 15 minutes or contact support.\n\nPIN Locked\n\n• After 5 failed PIN attempts, your account is temporarily locked.\n• Use "Forgot PIN?" to reset via email verification.\n\nBiometrics Not Working\n\n• Go to Account > Security and toggle biometrics off, then back on.\n• Make sure biometrics are enrolled in your device settings.\n\nStill Need Help?\n\nContact us via Live Chat (24/7) or email support@usemoneymoves.xyz. Both are under Account > Help and support.`,
  },
];

export default function HelpArticlesScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const [expanded, setExpanded] = useState<number | null>(null);

  const toggle = (idx: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeInEaseOut", "opacity"));
    setExpanded(expanded === idx ? null : idx);
  };

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>Help articles</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* One card holding every article, opened in place. Nine separate
            bordered cards each with a coloured badge made a list of nine
            things look like nine unrelated features. */}
        <View style={[s.card, { backgroundColor: colors.card }]}>
          {ARTICLES.map((article, i) => {
            const isOpen = expanded === i;
            return (
              <View
                key={article.title}
                style={
                  i < ARTICLES.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  }
                }
              >
                <TouchableOpacity style={s.row} onPress={() => toggle(i)} activeOpacity={0.7}>
                  <View style={[s.icon, { backgroundColor: colors.muted }]}>
                    <Image
                      source={article.img}
                      style={[s.mark, { tintColor: isOpen ? colors.primary : colors.mutedForeground }]}
                      resizeMode="contain"
                    />
                  </View>
                  <View style={s.rowText}>
                    <Text style={[s.rowTitle, { color: colors.foreground }]}>{article.title}</Text>
                    {!isOpen && (
                      <Text style={[s.rowDesc, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {article.desc}
                      </Text>
                    )}
                  </View>
                  <Feather
                    name={isOpen ? "chevron-up" : "chevron-down"}
                    size={17}
                    color={colors.mutedForeground}
                  />
                </TouchableOpacity>

                {isOpen && (
                  <Text style={[s.body, { color: colors.mutedForeground }]}>{article.content}</Text>
                )}
              </View>
            );
          })}
        </View>

        <TouchableOpacity
          style={[s.chatRow, { backgroundColor: colors.card }]}
          onPress={() => router.push("/account/live-chat")}
          activeOpacity={0.75}
        >
          <View style={[s.icon, { backgroundColor: colors.muted }]}>
            <Image
              source={require("@/assets/images/customer-service.png")}
              style={[s.mark, { tintColor: colors.mutedForeground }]}
              resizeMode="contain"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.rowTitle, { color: colors.foreground }]}>Not covered here?</Text>
            <Text style={[s.rowDesc, { color: colors.mutedForeground }]}>Chat with an agent</Text>
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

  card: { marginHorizontal: 16, marginTop: 8, borderRadius: 18, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 14 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  mark: { width: 18, height: 18 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 14.5, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  rowDesc: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular", marginTop: 1 },
  // Indented to the title, so an open article reads as belonging to its row.
  body: {
    fontSize: 13.5,
    lineHeight: 22,
    fontFamily: "Inter_400Regular",
    paddingLeft: 51,
    paddingRight: 8,
    paddingBottom: 18,
  },

  chatRow: {
    flexDirection: "row", alignItems: "center", gap: 13,
    marginHorizontal: 16, marginTop: 16,
    borderRadius: 18, paddingHorizontal: 14, paddingVertical: 13,
  },
});
