import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";

/**
 * Renders a floating "Done" bar just above the keyboard on iOS.
 * No-op on Android (number-pad already has a checkmark key).
 */
export function KeyboardDoneBar() {
  const colors = useColors();
  const [visible, setVisible] = useState(false);
  const translateY = useRef(new Animated.Value(60)).current;
  const bottom = useRef(0);
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== "ios") return;

    const show = Keyboard.addListener("keyboardWillShow", (e) => {
      setKbHeight(e.endCoordinates.height);
      setVisible(true);
      Animated.timing(translateY, {
        toValue: 0,
        duration: e.duration || 250,
        useNativeDriver: true,
      }).start();
    });

    const hide = Keyboard.addListener("keyboardWillHide", (e) => {
      Animated.timing(translateY, {
        toValue: 60,
        duration: e.duration || 200,
        useNativeDriver: true,
      }).start(() => setVisible(false));
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (Platform.OS !== "ios" || !visible) return null;

  return (
    <Animated.View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: kbHeight,
        transform: [{ translateY }],
        zIndex: 999,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-end",
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: colors.card,
          borderTopWidth: 0.5,
          borderTopColor: colors.border,
        }}
      >
        <TouchableOpacity
          onPress={() => Keyboard.dismiss()}
          style={{ paddingHorizontal: 12, paddingVertical: 4 }}
        >
          <Text
            style={{
              color: colors.primary,
              fontSize: 16,
              fontFamily: "Inter_600SemiBold",
            }}
          >
            Done
          </Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}
