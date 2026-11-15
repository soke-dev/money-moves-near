import React, { useEffect, useRef } from "react";
import { Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

/**
 * A bottom sheet you pull down to close, on both platforms. The pull only
 * takes over while the content is scrolled to the top, so scrolling a long
 * sheet still scrolls it. Let go past a short distance, or flick, and it
 * closes; anything less springs back.
 */
export function DragDownSheet({
  visible,
  onClose,
  background,
  handle,
  bottomPad = 14,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  background: string;
  handle: string;
  bottomPad?: number;
  children: React.ReactNode;
}) {
  const { height } = useWindowDimensions();
  const y = useRef(new Animated.Value(0)).current;
  const atTop = useRef(true);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (visible) {
      y.setValue(0);
      atTop.current = true;
    }
  }, [visible, y]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => atTop.current && g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => y.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 110 || g.vy > 0.9) {
          Animated.timing(y, { toValue: height, duration: 180, useNativeDriver: true }).start(() => close.current());
        } else {
          Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
      onPanResponderTerminate: () => Animated.spring(y, { toValue: 0, useNativeDriver: true }).start(),
    }),
  ).current;

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <Animated.View
        {...pan.panHandlers}
        style={[s.sheet, { backgroundColor: background, paddingBottom: bottomPad, maxHeight: height * 0.9, transform: [{ translateY: y }] }]}
      >
        <View style={s.grab}>
          <View style={[s.handle, { backgroundColor: handle }]} />
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(e) => {
            atTop.current = e.nativeEvent.contentOffset.y <= 0;
          }}
          contentContainerStyle={{ paddingBottom: 8 }}
        >
          {children}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20 },
  grab: { alignItems: "center", paddingTop: 10, paddingBottom: 14 },
  handle: { width: 40, height: 4, borderRadius: 2 },
});
