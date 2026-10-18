import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Linking,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { SettingRow, SettingGroup } from "@/components/SettingsRow";

const SUPPORT_EMAIL = "support@usemoneymoves.xyz";
const X_HANDLE = "usemoneymoves";
const TERMS_URL = "https://usemoneymoves.xyz/terms";

export default function SupportScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  /**
   * Opens the mail app, and says so plainly when there is not one.
   *
   * A silent no-op on a device with no mail account configured would read as a
   * dead row, so the address is shown instead - it is the thing the user
   * actually needs.
   */
  const email = (subject: string) => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`).catch(() =>
      Alert.alert("No mail app", `Write to us at ${SUPPORT_EMAIL}`),
    );
  };

  const open = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>Help and support</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Ordered by how quickly it answers: a person first, then the things
            that answer without waiting for one. The old page spent its top
            third on a decorative headphones badge saying "Here for you 24/7". */}
        <SettingGroup label="GET HELP">
          <SettingRow
            img={require("@/assets/images/customer-service.png")}
            title="Live chat"
            subtitle="Talk to an agent, any time"
            onPress={() => router.push("/account/conversations")}
          />
          <SettingRow
            img={require("@/assets/images/content-writing.png")}
            title="Help articles"
            subtitle="Step by step guides"
            onPress={() => router.push("/account/help-articles")}
          />
          <SettingRow
            img={require("@/assets/images/faq.png")}
            title="FAQs"
            subtitle="Quick answers to common questions"
            onPress={() => router.push("/account/faq")}
            last
          />
        </SettingGroup>

        <SettingGroup label="CONTACT US">
          <SettingRow
            img={require("@/assets/images/send.png")}
            title="Email support"
            subtitle={SUPPORT_EMAIL}
            onPress={() => email("Help with my account")}
          />
          <SettingRow
            img={require("@/assets/images/edit.png")}
            title="Share your feedback"
            subtitle="Tell us what to build next"
            onPress={() => email("Feedback")}
            last
          />
        </SettingGroup>

        <SettingGroup label="FOLLOW US">
          <SettingRow
            // No X mark among the app's images, and the letter is the logo.
            mark={<Text style={[s.xMark, { color: colors.mutedForeground }]}>𝕏</Text>}
            title="Follow on X"
            subtitle={`@${X_HANDLE}`}
            onPress={() => open(`https://x.com/${X_HANDLE}`)}
            last
          />
        </SettingGroup>

        {/* Last, where the small print goes. The address is the subtitle, the
            way the support email is, so it is readable to someone who would
            rather open it on a computer. */}
        <SettingGroup label="LEGAL">
          <SettingRow
            mark={<Feather name="file-text" size={17} color={colors.mutedForeground} />}
            title="Terms of service"
            subtitle="usemoneymoves.xyz/terms"
            onPress={() => open(TERMS_URL)}
            last
          />
        </SettingGroup>
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
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  xMark: { fontSize: 17, lineHeight: 22, fontFamily: "Inter_700Bold" },
});
