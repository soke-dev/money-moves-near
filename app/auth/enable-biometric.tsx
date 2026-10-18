import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

export default function EnableBiometricScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setBioLogin, setBioTx, hasWallet, walletType } = useApp();
  /**
   * Always home. Nobody is sent to make a 12-word wallet any more.
   *
   * This used to read `!hasWallet && walletType === null` as "legacy user who
   * needs the mnemonic screen". But a Dynamic wallet is derived in the
   * background at sign-in, and during that window the state is EXACTLY that:
   * no wallet yet, type not known yet. So the condition meant "not finished
   * loading" as often as it meant "legacy", and new email accounts were sent
   * to create a second, mnemonic wallet on top of the one still arriving -
   * which then overwrote the address money had already been sent to.
   *
   * Home self-heals either way: it derives from Dynamic, or from an embedded
   * key already on the device.
   */
  const nextDest = "/(tabs)" as any;
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const [biometricLabel, setBiometricLabel] = useState("Biometrics");
  const [biometricIcon, setBiometricIcon] = useState<string>("smartphone");
  const isFaceId = biometricLabel === "Face ID";

  useEffect(() => {
    (async () => {
      if (Platform.OS === "web") return;
      try {
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
        if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          setBiometricLabel("Face ID");
          setBiometricIcon("smile");
        } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
          setBiometricLabel("Fingerprint");
          setBiometricIcon("activity");
        }
      } catch {}
    })();
  }, []);

  const handleEnable = async () => {
    if (Platform.OS === "web") {
      Alert.alert("Info", "Biometrics not available on web");
      router.replace(nextDest);
      return;
    }
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: `Enable ${biometricLabel}`,
        fallbackLabel: "Skip",
      });
      if (result.success) {
        await setBioLogin(true);
        await setBioTx(true);
      }
    } catch {}
    router.replace(nextDest);
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: topPad + 28,
          paddingBottom: bottomPad + 16,
        },
      ]}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>First things first</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Secure your account with {biometricLabel} and approve payments in a glance.
      </Text>

      <View style={styles.hero}>
        {isFaceId ? (
          <Image
            source={require("@/assets/images/face-id.png")}
            // The asset is solid black, so it must be tinted to show on the dark
            // background. Lime keeps it on-brand rather than plain white.
            style={[styles.heroIcon, { tintColor: colors.primary }]}
            resizeMode="contain"
          />
        ) : (
          <Feather name={biometricIcon as any} size={104} color={colors.primary} />
        )}
        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          You can always use your PIN instead.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
        onPress={handleEnable}
        activeOpacity={0.85}
      >
        <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
          Enable {biometricLabel}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.skipBtn} onPress={() => router.replace(nextDest)}>
        <Text style={[styles.skipText, { color: colors.mutedForeground }]}>Skip for now</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  title: {
    fontSize: 20,
    lineHeight: 27,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 26,
  },
  hero: { flex: 1, alignItems: "center", justifyContent: "center" },
  heroIcon: { width: 108, height: 108 },
  note: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 36,
  },
  primaryBtn: {
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { fontSize: 16, lineHeight: 22, fontFamily: "Inter_600SemiBold" },
  skipBtn: { alignItems: "center", paddingVertical: 14, marginTop: 2 },
  skipText: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_500Medium" },
});
