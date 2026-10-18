import { Redirect } from "expo-router";
import { useApp } from "@/context/AppContext";
import { View } from "react-native";
import { useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const ONBOARDING_KEY = "mm_onboarded";

export default function Index() {
  const { isLoggedIn, isPinSet, isReady, user } = useApp();
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    // DEV: uncomment next line to re-show onboarding
    // AsyncStorage.removeItem(ONBOARDING_KEY);
    AsyncStorage.getItem(ONBOARDING_KEY).then((v) => setHasOnboarded(v === "1"));
  }, []);

  if (!isReady || hasOnboarded === null) {
    // Plain dark screen (matches the animated splash) — no spinner, so the
    // hand-off from splash to app stays seamless.
    return <View style={{ flex: 1, backgroundColor: "#0a0a0a" }} />;
  }

  if (!hasOnboarded) {
    return <Redirect href="/auth/onboarding" />;
  }

  if (!isLoggedIn) {
    return <Redirect href="/auth/dynamic-onboarding" />;
  }
  if (user && (!user.emailVerified || !user.loginVerified)) {
    return <Redirect href="/auth/verify-email" />;
  }
  if (!isPinSet) {
    return <Redirect href="/auth/set-pin" />;
  }
  return <Redirect href="/auth/pin" />;
}
