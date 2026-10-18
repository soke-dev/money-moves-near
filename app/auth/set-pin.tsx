import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

/**
 * First-time PIN setup. Deliberately impersonal — no avatar or name here (the
 * user has only just signed up); the greeting belongs on the returning-user
 * lock screen (auth/pin.tsx).
 */
export default function SetPinScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setPin, setUnlocked, logout } = useApp();
  const [pin, setPinState] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [step, setStep] = useState<"set" | "confirm">("set");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const currentPin = step === "set" ? pin : confirmPin;

  const handleDigit = (digit: string) => {
    if (currentPin.length >= 4 || loading) return;
    const newVal = currentPin + digit;
    if (step === "set") {
      setPinState(newVal);
      if (newVal.length === 4) {
        setTimeout(() => setStep("confirm"), 200);
      }
    } else {
      setConfirmPin(newVal);
      if (newVal.length === 4) {
        setTimeout(async () => {
          if (newVal === pin) {
            setLoading(true);
            try {
              await setPin(pin);
              setUnlocked(true);
              router.replace("/auth/enable-biometric");
            } catch {
              setError(true);
              setConfirmPin("");
            } finally {
              setLoading(false);
            }
          } else {
            setError(true);
            setConfirmPin("");
          }
        }, 100);
      }
    }
  };

  const handleDelete = () => {
    if (step === "set") setPinState((p) => p.slice(0, -1));
    else setConfirmPin((p) => p.slice(0, -1));
    setError(false);
  };

  const displayPin = step === "set" ? pin : confirmPin;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: topPad + 12,
          paddingBottom: bottomPad + 16,
        },
      ]}
    >
      {/* Top bar: back (confirm step only) + logout */}
      <View style={styles.topBar}>
        {step === "confirm" ? (
          <TouchableOpacity
            style={[styles.circleBtn, { backgroundColor: colors.muted }]}
            onPress={() => {
              setStep("set");
              setPinState("");
              setConfirmPin("");
              setError(false);
            }}
            activeOpacity={0.7}
          >
            <Feather name="chevron-left" size={20} color={colors.foreground} />
          </TouchableOpacity>
        ) : (
          <View style={styles.circleBtn} />
        )}
        <TouchableOpacity
          onPress={async () => {
            await logout();
            router.replace("/auth/dynamic-onboarding" as any);
          }}
          hitSlop={10}
        >
          <Text style={[styles.logoutText, { color: colors.mutedForeground }]}>Logout</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primary }]}>
          <Image
            source={require("@/assets/images/lock.png")}
            style={styles.lockIcon}
            resizeMode="contain"
          />
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>
          {step === "set" ? "Create your PIN" : "Confirm your PIN"}
        </Text>
        <Text
          style={[
            styles.subtitle,
            { color: error ? colors.destructive : colors.mutedForeground },
          ]}
        >
          {step === "set"
            ? "Used to log in and approve transactions."
            : error
            ? "PINs don't match. Try again."
            : "Re-enter the 4 digits to confirm."}
        </Text>

        <View style={styles.dotsRow}>
          {[0, 1, 2, 3].map((i) => {
            const filled = i < displayPin.length;
            return (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor: filled
                      ? error
                        ? colors.destructive
                        : colors.primary
                      : "transparent",
                    borderColor: error
                      ? colors.destructive
                      : filled
                      ? colors.primary
                      : colors.border,
                  },
                ]}
              />
            );
          })}
        </View>
      </View>

      {/* Keypad */}
      <View style={styles.keypad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <TouchableOpacity
            key={d}
            style={styles.key}
            onPress={() => handleDigit(d)}
            activeOpacity={0.6}
          >
            <Text style={[styles.keyText, { color: colors.foreground }]}>{d}</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.key} />
        <TouchableOpacity
          style={styles.key}
          onPress={() => handleDigit("0")}
          activeOpacity={0.6}
        >
          <Text style={[styles.keyText, { color: colors.foreground }]}>0</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.key} onPress={handleDelete} activeOpacity={0.6}>
          <Feather name="delete" size={22} color={colors.foreground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutText: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_500Medium" },
  content: {
    flex: 1,
    alignItems: "center",
    // Top-aligned so the lock icon + title sit just under the Logout row; the
    // keypad stays anchored at the bottom of the screen.
    justifyContent: "flex-start",
    paddingTop: 28,
    gap: 6,
  },
  iconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 24, lineHeight: 32,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.4,
    marginBottom: 4,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15, lineHeight: 20,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 20,
  },
  lockIcon: { width: 38, height: 38 },
  dotsRow: { flexDirection: "row", gap: 16, marginTop: 36 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  keypad: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16 },
  key: { width: "33.33%", height: 78, alignItems: "center", justifyContent: "center" },
  keyText: { fontSize: 28, lineHeight: 38, fontFamily: "Inter_400Regular" },
});
