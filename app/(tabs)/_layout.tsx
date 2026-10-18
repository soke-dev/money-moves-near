import { Redirect, Tabs } from "expo-router";
import { Platform, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { LiquidTabBar } from "@/components/LiquidTabBar";

/**
 * Home sits in the middle, Account left, Finance right.
 *
 * Declaration order is what the bar renders, so Home is no longer first - and
 * the first screen is otherwise the one the app opens on. initialRouteName
 * keeps Home as the landing tab regardless of where it sits in the row.
 */
export const unstable_settings = {
  initialRouteName: "index",
};

export default function TabLayout() {
  const colors = useColors();
  const { isReady, isLoggedIn, isPinSet, unlocked } = useApp();

  /**
   * Render nothing until the stored session has been read.
   *
   * Both guards below need isReady, so before it lands they all fall through
   * and the tabs mount - Home appeared, started loading, and was yanked to the
   * PIN screen a moment later. A plain background instead of the tabs holds the
   * hand-off from the animated splash still, with no spinner to flash.
   */
  if (!isReady) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  /**
   * Nobody signed in has no business rendering the tabs at all: Home would sit
   * on empty state loading forever.
   *
   * Sent to an explicit route, never to "/". `(tabs)` is a group, so it is
   * transparent in the URL and app/(tabs)/index.tsx resolves to "/" exactly
   * like app/index.tsx does - redirecting there from inside this layout lands
   * back in the tabs and re-fires this guard, which is a render loop
   * ("Maximum update depth exceeded"), not a redirect.
   */
  if (!isLoggedIn) {
    return <Redirect href="/auth/dynamic-onboarding" />;
  }

  /**
   * The PIN lock is enforced here, not by the screens that navigate in.
   *
   * Several paths reach the tabs directly - wallet-setup, cloud-backup, and
   * auth/index, which catches the `money-moves://auth` deep link Dynamic fires
   * after email OTP and redirected straight here on the assumption the session
   * is already unlocked. After a logout and a fresh sign-in that assumption is
   * false, and the app opened without ever asking for a PIN or Face ID.
   *
   * Guarding the destination instead of each route in is the only version of
   * this that cannot be bypassed by adding another entry point later.
   *
   * Gated on isPinSet so a user who has not set one yet is not bounced into a
   * screen they cannot satisfy; index.tsx sends them to set-pin. Web has no
   * lock screen.
   */
  if (Platform.OS !== "web" && isPinSet && !unlocked) {
    return <Redirect href="/auth/pin" />;
  }

  return (
    <Tabs
      tabBar={(props) => <LiquidTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="account" options={{ title: "Account" }} />
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="finance" options={{ title: "Finance" }} />

      {/* Off the bar, still routable. */}
      <Tabs.Screen name="rates" options={{ href: null }} />
      <Tabs.Screen name="savings" options={{ href: null }} />
    </Tabs>
  );
}
