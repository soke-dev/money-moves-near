import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

// Where the Aurora widget wrapper page is hosted. Override per environment
// — this should serve `/intents-deposit?address=…` (web/src/pages/IntentsDeposit.tsx).
const WIDGET_HOST = "https://usemoneymoves.xyz";

export default function CrossChainDepositScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { walletReady, walletAddresses } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const movementAddress = walletAddresses["MOVE"] || "";

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!walletReady) {
      Alert.alert("Wallet Required", "Create your wallet first to receive deposits.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    }
  }, [walletReady]);

  const widgetUrl =
    `${WIDGET_HOST}/intents-deposit` +
    `?address=${encodeURIComponent(movementAddress)}` +
    `&theme=dark`;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Receive from another chain</Text>
        <View style={{ width: 24 }} />
      </View>

      {!movementAddress ? (
        <View style={styles.placeholder}>
          <Feather name="alert-circle" size={48} color={colors.mutedForeground} />
          <Text style={[styles.placeholderText, { color: colors.foreground }]}>
            Set up your Movement wallet first.
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {loading && (
            <View style={[styles.loadingOverlay, { backgroundColor: colors.background }]}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading deposit widget…</Text>
            </View>
          )}
          <WebView
            source={{ uri: widgetUrl }}
            originWhitelist={["*"]}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState={false}
            onLoadEnd={() => setLoading(false)}
            onError={() => setLoading(false)}
            style={{ flex: 1, backgroundColor: colors.background }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  title: { fontSize: 17, fontFamily: "Inter_700Bold" },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  placeholderText: { fontSize: 15, fontFamily: "Inter_500Medium", textAlign: "center" },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
