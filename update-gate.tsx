import React from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

/**
 * The whole app, for builds too old to be updated any other way.
 *
 * An update only applies within its own runtime version, so the builds on
 * 1.0.0, 1.0.6 and 1.0.7 never receive anything published for 2.0.0 - they go
 * on running the code they shipped with, against an API that has moved years
 * of decisions past them. The only thing that reaches them is an update
 * published *at their own runtime*, which is what this is.
 *
 * It imports react-native and nothing else on purpose. Those shells were
 * compiled in April and May, before Dynamic, ML Kit, nitro-modules and
 * quick-crypto were in this project, and a bundle that reaches for a native
 * module the shell does not contain does not show a message - it crashes on
 * launch, and a crashed app cannot download its own replacement. Every import
 * added here is a way to strand somebody permanently.
 *
 * No fonts either: the real app loads Inter through expo-font before it draws,
 * and waiting on that is another thing that can fail. The system face is what
 * a message like this should be set in anyway.
 */

/** The same two links the app's own store badges and the website use. */
const STORE = Platform.select({
  android: "https://play.google.com/store/apps/details?id=xyz.usemoneymoves.app",
  ios: "https://apps.apple.com/ng/app/money-moves-own-spend-crypto/id6785696053",
  default: "https://usemoneymoves.xyz",
}) as string;

export default function UpdateGate() {
  return (
    <View style={s.root}>
      <View style={s.body}>
        <Text style={s.mark}>m</Text>

        <Text style={s.title}>Time to update</Text>
        <Text style={s.copy}>
          This version of Money Moves is no longer supported. Update to the latest
          version to keep sending, selling and paying bills.
        </Text>
        <Text style={s.copySmall}>
          Your money and your account are untouched. Everything is where you left
          it once you update.
        </Text>

        <Pressable
          style={({ pressed }) => [s.btn, pressed && s.btnDown]}
          onPress={() => Linking.openURL(STORE).catch(() => {})}
        >
          <Text style={s.btnText}>
            {Platform.OS === "ios" ? "Open the App Store" : "Open Play Store"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center" },
  body: { paddingHorizontal: 30, alignItems: "center" },

  mark: {
    fontSize: 40,
    fontWeight: "800",
    color: "#81FB02",
    letterSpacing: -2,
    marginBottom: 26,
  },

  title: {
    fontSize: 27,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: -0.8,
    textAlign: "center",
  },
  copy: {
    marginTop: 14,
    fontSize: 15,
    lineHeight: 22,
    color: "#b9bcb4",
    textAlign: "center",
  },
  copySmall: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 19,
    color: "#7e817a",
    textAlign: "center",
  },

  btn: {
    marginTop: 30,
    alignSelf: "stretch",
    height: 54,
    borderRadius: 27,
    backgroundColor: "#81FB02",
    alignItems: "center",
    justifyContent: "center",
  },
  btnDown: { opacity: 0.85 },
  btnText: { fontSize: 16, fontWeight: "700", color: "#0a0a0a" },
});
