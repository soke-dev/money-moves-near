import { useEffect, useState } from "react";
import { Dimensions, Keyboard, Platform } from "react-native";

/**
 * How far to lift content so the keyboard does not cover it.
 *
 * Use this instead of KeyboardAvoidingView for anything inside a Modal. On iOS
 * a Modal is its own window and is already resized for the keyboard, so a
 * KeyboardAvoidingView within it adds that height a second time and pushes the
 * content off-screen - which reads as the sheet going blank rather than as a
 * layout error.
 *
 * ── Android, and why this is not simply 0 ───────────────────────────────────
 *
 * It used to be. Expo resized the activity window for the keyboard, so adding
 * the height again moved everything twice: titles off the top of the screen and
 * the button off the bottom.
 *
 * SDK 54 made edge-to-edge the default, and under edge-to-edge the window is no
 * longer resized - the system hands you the insets and expects you to do it.
 * Nothing lifted, so on the sign-in screen the Continue button stayed behind
 * the keyboard while the same screen worked on iOS.
 *
 * Rather than swap one assumption for the other, this measures. The window
 * height with no keyboard up is remembered; when the keyboard appears and the
 * window has shrunk by roughly that much, the platform has done the lifting and
 * this returns 0. When it has not, this returns the keyboard's height. Both
 * behaviours are then correct without anyone having to know which one a given
 * device, OS version or build configuration is doing.
 *
 * iOS listens on the "Will" events so a sheet animates with the keyboard rather
 * than snapping after it lands. Android has no reliable "will", so it does not.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === "web") return;

    if (Platform.OS === "ios") {
      const show = Keyboard.addListener("keyboardWillChangeFrame", (e: any) =>
        setHeight(e?.endCoordinates?.height ?? 0),
      );
      const hide = Keyboard.addListener("keyboardWillHide", () => setHeight(0));
      return () => {
        show.remove();
        hide.remove();
      };
    }

    // Re-read on every hide, so a rotation or a split-screen change re-bases it
    // rather than leaving the comparison against a window that no longer exists.
    let restHeight = Dimensions.get("window").height;

    const show = Keyboard.addListener("keyboardDidShow", (e: any) => {
      const keyboard = e?.endCoordinates?.height ?? 0;
      const shrankBy = restHeight - Dimensions.get("window").height;
      // Half, not all: the window loses the keyboard's height minus whatever
      // system bars it was already drawing under, so the two are close but
      // never equal. Anything near it means the resize happened.
      setHeight(shrankBy >= keyboard * 0.5 ? 0 : keyboard);
    });

    const hide = Keyboard.addListener("keyboardDidHide", () => {
      restHeight = Dimensions.get("window").height;
      setHeight(0);
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
