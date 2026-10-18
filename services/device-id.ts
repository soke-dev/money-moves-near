import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * expo-application, if this binary has it.
 *
 * Deliberately not `import * as Application from "expo-application"`. That
 * package's entry point is `requireNativeModule("ExpoApplication")`, which
 * THROWS when the native side is absent - and it throws at import, before any
 * try/catch in here can run. This file is imported by services/api.ts, which
 * is imported by almost everything, so on a build without the module that is
 * not a degraded device id, it is an app that will not start.
 *
 * Which matters because the module arrives in 2.0.1 and every install today is
 * 2.0.0. The optional form returns null instead of throwing, so one bundle
 * runs on both binaries: the newer one gets ANDROID_ID, the older one quietly
 * falls back to the stored value, and updates can go to both while the store
 * build works its way through review.
 */
const ExpoApplication = requireOptionalNativeModule<{ androidId?: string | null }>(
  "ExpoApplication",
);

/**
 * A name for this handset, made once and kept.
 *
 * Not the user-agent. Four hundred of our sessions report the identical string
 * "okhttp/4.12.0", because that is the HTTP library every Android build ships
 * with - it says what the request was made by, never by whom.
 *
 * Not the IP either. Nine per cent of our addresses already serve more than one
 * account, and the worst offenders are MTN and Airtel carrier NAT, where
 * thousands of real people share one address. Counting accounts per IP would
 * refuse genuine signups in our largest market and be beaten by turning wifi
 * off.
 *
 * So: a name for the handset, kept in device storage. On iOS it is a random
 * value we invent; on Android it is a SHA-256 of the system ANDROID_ID, which
 * is what makes it outlive a reinstall there.
 *
 * Hashed rather than sent raw, because ANDROID_ID is readable by other apps on
 * the same handset and sending it as-is would let this identifier be lined up
 * against theirs. The digest cannot be reversed to it, so what leaves the
 * device identifies a handset to us and to nobody else.
 *
 * ── How long it survives ─────────────────────────────────────────────
 *
 * On iOS, SecureStore is the keychain, and keychain entries outlive the app -
 * deleting and reinstalling gets the same identifier back.
 *
 * On Android, SecureStore is EncryptedSharedPreferences and is wiped with the
 * app, so a stored value alone would treat a reinstall as a new handset. So
 * Android asks the system first, from 2.0.1 onwards: ANDROID_ID is stable for
 * the life of the install of this signing key and survives the app being
 * removed. On 2.0.0, which has no such module, and on the rare handset that
 * returns nothing, the stored value is the answer.
 *
 * Whatever is used, the answer is written back to storage, so a handset keeps
 * the same name even if a later read of the system id fails.
 *
 * Still a deterrent rather than a wall - a factory reset clears ANDROID_ID,
 * and a determined person has other options. What stops determined people is
 * the identity check, which already refuses a face it has seen before.
 */

const KEY = "mm_device_id";

/** Held after the first read: this is asked for on every request. */
let cached: string | null = null;

export async function getDeviceId(): Promise<string | null> {
  if (cached) return cached;
  try {
    /**
     * The system id first on Android, because it outlives the app and the
     * stored value does not. Prefixed so the two kinds are never mistaken for
     * one another in the data, and hashed so the raw ANDROID_ID - which other
     * apps on the handset can also read - never leaves the device.
     */
    if (Platform.OS === "android") {
      // Null on 2.0.0, which has no such module. The stored value below is the
      // answer there, exactly as it was before this existed.
      const raw = ExpoApplication?.androidId ?? null;
      if (raw) {
        const hashed = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          `mm:${raw}`,
        );
        cached = "a" + hashed.slice(0, 32);
        // Written back so a later read that fails still finds the same name.
        await SecureStore.setItemAsync(KEY, cached).catch(() => {});
        return cached;
      }
    }

    const existing = await SecureStore.getItemAsync(KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
    // Hex rather than a UUID, so it matches the server's character check
    // without either end having to agree on a dash pattern.
    const made = Array.from(Crypto.getRandomBytes(16))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await SecureStore.setItemAsync(KEY, made);
    cached = made;
    return made;
  } catch {
    /**
     * A device that will not give us storage gets no identifier, and the
     * server treats that as unknown rather than as a device. Failing open is
     * the only safe direction: the alternative is refusing to let somebody
     * sign up because their keychain is unavailable.
     */
    return null;
  }
}
