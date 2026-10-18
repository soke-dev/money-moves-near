import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/inter";
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from "@expo-google-fonts/jetbrains-mono";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { ThemeProvider as NavThemeProvider, DarkTheme, DefaultTheme } from "@react-navigation/native";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AnimatedSplash } from "@/components/AnimatedSplash";
import {
  dynamicClient,
  isDynamicWebViewVisible,
  subscribeDynamicWebView,
} from "@/config/dynamic";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { KeyboardProviderCompat } from "@/components/KeyboardProviderCompat";
import { PausedSheet } from "@/components/PausedSheet";
import { UpdateRequired } from "@/components/UpdateRequired";
import { AppProvider } from "@/context/AppContext";
import { storeUpdateRequired, subscribeUpdateRequired } from "@/services/store-update";
import { ThemeProvider } from "@/context/ThemeContext";

import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const colors = useColors();
  const { theme } = useTheme();

  const navTheme = {
    ...(theme === "dark" ? DarkTheme : DefaultTheme),
    colors: {
      ...(theme === "dark" ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.background,
      card: colors.card,
      border: colors.border,
      text: colors.foreground,
      primary: colors.primary,
    },
  };

  return (
    <NavThemeProvider value={navTheme}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          /**
           * Slide in from the right on both platforms.
           *
           * iOS was fading, which gives no sense of direction: a screen that
           * dissolves into place could be a push, a replace, or a modal. Sliding
           * says you moved forward and that back retraces it, which is also what
           * the edge-swipe gesture is already doing.
           *
           * Screens that want something else - the KYC sheet fades over the one
           * behind it - still set their own.
           */
          animation: "slide_from_right",
        }}
      >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="auth/onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="auth/dynamic-onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="auth/login" options={{ headerShown: false }} />
      <Stack.Screen name="auth/register" options={{ headerShown: false }} />
      <Stack.Screen name="auth/pin" options={{ headerShown: false }} />
      <Stack.Screen name="auth/set-pin" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="buy" options={{ headerShown: false }} />
      <Stack.Screen name="sell" options={{ headerShown: false }} />
      <Stack.Screen name="airtime" options={{ headerShown: false }} />
      <Stack.Screen name="airtime-summary" options={{ headerShown: false }} />
      <Stack.Screen name="electricity" options={{ headerShown: false }} />
      <Stack.Screen name="electricity-summary" options={{ headerShown: false }} />
      <Stack.Screen name="tv" options={{ headerShown: false }} />
      <Stack.Screen name="tv-summary" options={{ headerShown: false }} />
      {/* Sweep is a sheet, not a page: it is one decision taken from the
          Assets list and handed straight back to it, and the list should stay
          visible underneath. Same arrangement as KYC - no navigator animation,
          the sheet slides itself, and the transparent contentStyle overrides
          the Stack's opaque default so it does not render on black. */}
      <Stack.Screen
        name="sweep"
        options={{
          headerShown: false,
          presentation: "transparentModal",
          // No navigator animation: the sheet fades its own blur and slides its
          // own card. A transition here would drag both up as one rectangle.
          animation: "none",
          contentStyle: { backgroundColor: "transparent" },
        }}
      />
      <Stack.Screen name="deposit" options={{ headerShown: false }} />
      <Stack.Screen name="deposit-routed" options={{ headerShown: false }} />
      <Stack.Screen name="transfer" options={{ headerShown: false }} />
      <Stack.Screen name="bank-select" options={{ headerShown: false }} />
      <Stack.Screen name="bank-amount" options={{ headerShown: false }} />
      <Stack.Screen name="bank-summary" options={{ headerShown: false }} />
      <Stack.Screen name="withdraw-select" options={{ headerShown: false }} />
      <Stack.Screen name="withdraw-detail" options={{ headerShown: false }} />
      <Stack.Screen name="withdraw-summary" options={{ headerShown: false }} />
      <Stack.Screen name="business-pay" options={{ headerShown: false }} />
      <Stack.Screen name="business-checkout" options={{ headerShown: false }} />
      <Stack.Screen name="transactions/index" options={{ headerShown: false }} />
      {/* A sheet rather than a page: a transaction is something you glance at
          and dismiss, and sliding it over what you were looking at keeps the
          list behind it rather than replacing it. */}
      <Stack.Screen
        name="transactions/detail"
        options={{ headerShown: false, presentation: "modal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen name="transactions/summary" options={{ headerShown: false }} />
      <Stack.Screen
        name="transactions/receipt"
        options={{ headerShown: false, presentation: "fullScreenModal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen name="account/profile" options={{ headerShown: false }} />
      {/* KYC is a bottom sheet — present it over the previous screen.

          No navigator animation: the screen appears at once and the sheet
          animates itself, so the backdrop can fade while the sheet slides.
          A navigator transition here would move both together and fight the
          one inside the screen. */}
      <Stack.Screen
        name="account/kyc"
        options={{
          headerShown: false,
          presentation: "transparentModal",
          animation: "none",
          // Must override the Stack's global opaque contentStyle, otherwise the
          // sheet renders on black instead of over the previous screen.
          contentStyle: { backgroundColor: "transparent" },
        }}
      />
      <Stack.Screen name="account/limits" options={{ headerShown: false }} />
      <Stack.Screen name="auth/verify-email" options={{ headerShown: false }} />
      <Stack.Screen name="auth/enable-biometric" options={{ headerShown: false }} />
      <Stack.Screen name="auth/wallet-setup" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="auth/cloud-backup" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="select-crypto" options={{ headerShown: false }} />
      <Stack.Screen name="username-lookup" options={{ headerShown: false }} />
      <Stack.Screen name="username-send" options={{ headerShown: false }} />
      <Stack.Screen name="username-send-summary" options={{ headerShown: false }} />
      <Stack.Screen name="deposit-fiat" options={{ headerShown: false }} />
      <Stack.Screen name="deposit-naira" options={{ headerShown: false }} />
      <Stack.Screen name="deposit-naira-transfer" options={{ headerShown: false }} />
      <Stack.Screen name="bills" options={{ headerShown: false }} />
    </Stack>
    </NavThemeProvider>
  );
}

function ThemedRoot() {
  const colors = useColors();
  // Once the server refuses this build, the navigator goes and nothing mounted
  // under it can open a sheet or redirect over the screen that replaces it.
  const [updateRequired, setUpdateRequired] = useState(storeUpdateRequired);
  useEffect(() => subscribeUpdateRequired(setUpdateRequired), []);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProviderCompat>
          {updateRequired ? <UpdateRequired required={updateRequired} /> : <RootLayoutNav />}
          <PausedSheet />
        </KeyboardProviderCompat>
      </GestureHandlerRootView>
    </View>
  );
}

/**
 * Hosts the Dynamic SDK's WebView.
 *
 * It must stay mounted for the whole app lifetime - unmounting revokes the WaaS
 * signed session - but it has no style prop of its own and will paint over the
 * UI if left in normal flow. So it is parked off-screen, and brought on-screen
 * only while a signature is in flight: an off-screen transparent WKWebView can
 * be throttled by iOS, and any approval step Dynamic renders would have nowhere
 * to appear, leaving signMessage to hang with nothing to show the user.
 */
function DynamicWebViewHost() {
  const [visible, setVisible] = useState(isDynamicWebViewVisible);

  useEffect(() => subscribeDynamicWebView(setVisible), []);

  return (
    <View
      style={visible ? styles.dynamicWebViewLive : styles.dynamicWebViewHost}
      pointerEvents={visible ? "auto" : "none"}
    >
      <dynamicClient.reactNative.WebView />
    </View>
  );
}

const styles = StyleSheet.create({
  // Keeps the Dynamic WebView mounted (so the WaaS signed session stays alive)
  // and FULL SIZE so its page actually loads — a 1x1/offscreen webview can fail
  // to initialise, which stalls sdk.waitForReady(). It's made invisible and put
  // behind the app instead, so it can never cover the UI.
  dynamicWebViewHost: {
    // Off-screen rather than absoluteFill: a full-screen host sat over the whole
    // app and could swallow touches. Kept at a real size (not 1x1) so the page
    // still initialises properly.
    position: "absolute",
    left: -2000,
    top: 0,
    width: 320,
    height: 480,
    opacity: 0,
  },
  // On-screen and interactive, for the duration of a signature only.
  dynamicWebViewLive: {
    ...StyleSheet.absoluteFillObject,
    opacity: 1,
    zIndex: 9999,
  },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    // For figures that are the whole point of a screen - the amount you are
    // depositing, what you get back. Bold is the body weight in this app, so
    // headline numbers need a step above it to read as headline.
    Inter_800ExtraBold,
    /**
     * For keys and addresses, and nothing else.
     *
     * A private key is a run of sixty-four characters that somebody compares
     * against another run of sixty-four characters, one at a time. Inter
     * draws 0 and O, 1 and l close enough that the comparison cannot be
     * trusted, and getting it wrong on that screen means importing a wallet
     * that is not yours and concluding your money is gone.
     *
     * Two weights: regular for the characters, medium where a line needs to
     * carry a little more presence.
     */
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    ...Feather.font,
    ...MaterialIcons.font,
  });
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      {/* Dynamic SDK runs inside this WebView. It must stay mounted for the whole
          app lifetime (unmounting revokes the WaaS signed session), but it has no
          style prop and will paint over the UI if left in normal flow — so host it
          off-screen and non-interactive. Mounted above the router so navigation
          never unmounts it. */}
      <DynamicWebViewHost />
      <ThemeProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <AppProvider>
              <ThemedRoot />
            </AppProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </ThemeProvider>
      {!splashDone && <AnimatedSplash onFinish={() => setSplashDone(true)} />}
    </SafeAreaProvider>
  );
}
