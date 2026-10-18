import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { SettingRow, SettingGroup, SettingToggle } from "@/components/SettingsRow";
import { getNotificationPrefs, updateNotificationPrefs, NotificationPrefs } from "@/services/notifications";
import { openAppSettings } from "@/components/BackgroundAlertsSheet";

interface Item {
  key: keyof NotificationPrefs;
  img: any;
  title: string;
  subtitle: string;
}

/**
 * Grouped by what the notification is about, rather than listed flat.
 *
 * The order also puts money first: it is the only group most people come here
 * to change.
 */
const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "MONEY",
    items: [
      {
        key: "txAlerts",
        img: require("@/assets/images/transaction.png"),
        title: "Transactions",
        subtitle: "Funding, transfers and bills",
      },
      {
        key: "savingsAlerts",
        img: require("@/assets/images/piggy-bank.png"),
        title: "Savings",
        subtitle: "Maturity and interest updates",
      },
    ],
  },
  {
    label: "ACCOUNT",
    items: [
      {
        key: "securityAlerts",
        img: require("@/assets/images/lock.png"),
        title: "Security",
        subtitle: "Sign-ins and device changes",
      },
      {
        key: "appUpdates",
        img: require("@/assets/images/bell (1).png"),
        title: "App updates",
        subtitle: "New features worth knowing about",
      },
    ],
  },
  {
    label: "OFFERS",
    items: [
      {
        key: "promoAlerts",
        img: require("@/assets/images/brand.png"),
        title: "Rewards",
        subtitle: "Referrals and special offers",
      },
    ],
  },
];

export default function NotificationSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [prefs, setPrefs] = useState<Partial<NotificationPrefs>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getNotificationPrefs()
      .then(setPrefs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = (key: keyof NotificationPrefs) => {
    const next = !(prefs[key] ?? true);
    // Flipped first, saved after: a switch that waits on the network reads as
    // broken even when it works.
    setPrefs((prev) => ({ ...prev, [key]: next }));
    updateNotificationPrefs({ [key]: next } as Partial<NotificationPrefs>).catch(() =>
      setPrefs((prev) => ({ ...prev, [key]: !next })),
    );
  };

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.foreground }]}>Notifications</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* What the switches actually govern. The old note claimed security
          alerts ignored these settings, which is not what the server does -
          it honours every one of them for push, and records all of them in
          the app either way. */}
      <Text style={[s.lead, { color: colors.mutedForeground }]}>
        These control what we push to your phone. Everything still lands in your notifications
        list either way.
      </Text>

      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {GROUPS.map((group) => (
            <SettingGroup key={group.label} label={group.label}>
              {group.items.map((item, i) => (
                <SettingRow
                  key={item.key as string}
                  img={item.img}
                  title={item.title}
                  subtitle={item.subtitle}
                  onPress={() => toggle(item.key)}
                  last={i === group.items.length - 1}
                  right={
                    <SettingToggle
                      on={prefs[item.key] ?? true}
                      onToggle={() => toggle(item.key)}
                    />
                  }
                />
              ))}
            </SettingGroup>
          ))}

          {/* The switches above decide what we send; this is whether the
              phone lets it through once the app is swiped away. Many Android
              skins block that to save battery, and only the person can allow
              it. Always here, after the one-time prompt on Home. */}
          {Platform.OS === "android" && (
            <SettingGroup label="On this phone">
              <SettingRow
                img={require("@/assets/images/bell (1).png")}
                title="Alerts when the app is closed"
                subtitle="Some phones block them to save battery. Tap, then allow background activity."
                onPress={openAppSettings}
                last
                right={<Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
              />
            </SettingGroup>
          )}
        </ScrollView>
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
  lead: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 22,
    paddingBottom: 4,
  },
});
