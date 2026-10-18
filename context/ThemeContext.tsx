import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Theme = "dark" | "light";

/**
 * What the user asked for, which is not the same as what is on screen.
 *
 * "system" resolves against the device and keeps resolving: switching the
 * phone to dark at sunset now moves the app with it. The previous version read
 * the device scheme once at startup and then ignored it, so "follow my phone"
 * was not expressible at all.
 */
export type ThemePreference = "dark" | "light" | "system";

interface ThemeContextType {
  /** The theme actually in use, after resolving "system". */
  theme: Theme;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  /** Flips to the opposite of what is showing, and pins it. */
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  preference: "system",
  setPreference: () => {},
  toggleTheme: () => {},
  isDark: true,
});

const KEY = "@themePreference";
/** What the old build wrote. Read once so nobody's choice is lost. */
const LEGACY_KEY = "@theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const deviceScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(KEY);
        if (saved === "light" || saved === "dark" || saved === "system") {
          setPreferenceState(saved);
          return;
        }
        // Migrate the old binary setting: someone who had pinned light keeps
        // light rather than being quietly moved onto the device default.
        const legacy = await AsyncStorage.getItem(LEGACY_KEY);
        if (legacy === "light" || legacy === "dark") {
          setPreferenceState(legacy);
          AsyncStorage.setItem(KEY, legacy).catch(() => {});
        }
      } catch {
        // Unreadable storage just means the default, not a broken app.
      }
    })();
  }, []);

  const theme: Theme = useMemo(() => {
    if (preference === "system") return deviceScheme === "light" ? "light" : "dark";
    return preference;
  }, [preference, deviceScheme]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    AsyncStorage.setItem(KEY, p).catch(() => {});
  }, []);

  const toggleTheme = useCallback(() => {
    // Deliberately pins a concrete theme: someone reaching for the switch is
    // choosing, not asking to follow the device.
    setPreference(theme === "dark" ? "light" : "dark");
  }, [theme, setPreference]);

  return (
    <ThemeContext.Provider
      value={{ theme, preference, setPreference, toggleTheme, isDark: theme === "dark" }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
