import React, { useEffect } from "react";
import {
  View,
  Pressable,
  StyleSheet,
  Platform,
  Image,
  type ImageSourcePropType,
} from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";

/**
 * The tabs that appear, in the order they appear.
 *
 * This list is the filter, not `href: null`. Expo Router does not surface href
 * on the descriptor options a custom tab bar receives, so filtering on it
 * silently did nothing and Rates and Savings kept showing up.
 *
 * All three come from MaterialCommunityIcons. Ionicons' house has a chimney
 * with no chimney-less variant, and taking Home alone from another family left
 * it sitting on a different optical grid to its neighbours - drawn at a
 * different weight, reading a different size at the same point size. Icons in
 * a row like this have to be siblings, so the family moves rather than the one
 * icon.
 *
 * Home is an `image` instead - a supplied PNG, a solid silhouette with no
 * chimney. It is a single shape rather than a filled/outline pair, so it is
 * drawn twice and tinted, and the crossfade moves between the two tints. That
 * only works because the artwork is a flat silhouette: tintColor replaces
 * every opaque pixel, so anything with its own colours would come out solid.
 *
 * Finance is the other exception to the pair: this family has a `leaf` but no
 * `leaf-outline`, and the nearest pairs - `sprout` or `leaf-circle` - are a
 * different icon or would put a second circled glyph next to Account. It uses
 * the same glyph for both states, so selecting it changes colour without
 * filling in. The bubble and the colour still carry it.
 */
/**
 * The two ends the colour splits towards.
 *
 * Not pure red and blue: a saturated pair reads as a printing error rather
 * than as light. These are the warm and cool edges a real dispersion shows -
 * far enough apart to be seen, close enough to white to look like glass.
 */
const FRINGE_WARM = "#FF7A4D";
const FRINGE_COOL = "#4DA6FF";

const TABS: {
  name: string;
  on: keyof typeof MaterialCommunityIcons.glyphMap;
  off: keyof typeof MaterialCommunityIcons.glyphMap;
  image?: ImageSourcePropType;
}[] = [
  { name: "account", on: "account-circle", off: "account-circle-outline" },
  { name: "index", on: "home", off: "home-outline", image: require("@/assets/images/home.png") },
  { name: "finance", on: "leaf", off: "leaf" },
];

/**
 * Proportions taken off the reference, which is short and long rather than
 * tall: a 250x54 bar holding an 85x46 bubble inset ~4, radius ~13.
 *
 *   bar    width / height   4.63
 *   bubble width / height   1.85
 *   bubble height / bar     0.85
 *   radius / bubble height  0.28
 *
 * Ours was a 270x70 bar with an 82x58 bubble - 3.86 and 1.41, nearly square.
 * A bubble that square has no good corner radius: too little reads as hard
 * corners, too much as a lozenge. Widening it is what made the ends able to
 * round properly.
 *
 * The bar lands at 308x66 holding a 94x58 bubble, which still fits a 320pt
 * screen.
 */
const ITEM_W = 98;
const PAD = 4;
/**
 * The same as PAD, so the bubble is inset equally on all four sides.
 *
 * It used to be wider, to keep a squared-off corner clear of the bar's rounded
 * end. With fully rounded ends there is no corner to protect, and the extra
 * width was the reason the two shapes did not sit together: 7pt of gap at the
 * ends against 4pt above and below meant the curves were not concentric, and
 * the bubble's cap ran at a different arc to the bar's.
 *
 * Equal on every side, the bar's radius is exactly the bubble's plus the inset
 * (29 + 4 = 33, which is half the bar's height), so the two arcs are
 * concentric and the gap between them is a constant 4pt the whole way round.
 */
const BAR_PAD_X = PAD;
const BAR_H = 66;
// Full slot width - any narrower and the horizontal inset exceeds PAD again,
// which is what broke the nesting.
const PUCK_W = ITEM_W;
const PUCK_H = BAR_H - PAD * 2;
/**
 * Half the height: fully rounded ends, flat along the top and bottom.
 *
 * Every partial radius tried here - 14, 15, 18, 20 - read as a squared-off
 * corner rather than a rounded one. This is also the only radius that keeps a
 * constant gap to the bar's rim, since the bar is a stadium and the two curves
 * are then concentric, which is why nothing pinches at the first and last tab.
 */
const PUCK_R = PUCK_H / 2;
const ICON = 24;

/**
 * Two springs, deliberately mismatched.
 *
 * LEAD runs ahead and overshoots; TAIL is heavier and lags. The puck is drawn
 * to span both, so during travel it is pulled into a long thin capsule and
 * only rounds back up once TAIL catches up. One spring can only ever slide a
 * rigid shape - the second spring is what turns it into a substance.
 */
const LEAD = { damping: 14, stiffness: 190, mass: 0.9 };
const TAIL = { damping: 17, stiffness: 85, mass: 1.25 };
const POP = { damping: 11, stiffness: 200, mass: 0.75 };

const IOS = Platform.OS === "ios";

function TabItem({
  index,
  mid,
  spread,
  focused,
  label,
  iconOn,
  iconOff,
  image,
  color,
  labelColor,
  mutedColor,
  onPress,
}: {
  index: number;
  mid: SharedValue<number>;
  spread: SharedValue<number>;
  focused: boolean;
  label: string;
  iconOn: keyof typeof MaterialCommunityIcons.glyphMap;
  iconOff: keyof typeof MaterialCommunityIcons.glyphMap;
  image?: ImageSourcePropType;
  color: string;
  labelColor: string;
  mutedColor: string;
  onPress: () => void;
}) {
  const press = useSharedValue(1);
  const pop = useSharedValue(0);

  // One icon, either a font glyph or a tinted silhouette.
  const glyph = (name: keyof typeof MaterialCommunityIcons.glyphMap, tint: string) =>
    image ? (
      <Image source={image} style={[styles.iconImage, { tintColor: tint }]} />
    ) : (
      <MaterialCommunityIcons name={name} size={ICON} color={tint} />
    );

  /**
   * How much of the liquid is sitting under this tab: 1 when the puck is
   * centred here, 0 once it is a full slot away. Everything below is driven by
   * this one number, so the icons react continuously as the puck travels
   * rather than flipping when navigation commits.
   *
   * Read inline in every worklet, deliberately. Factoring it into a shared
   * helper worklet meant `mid` appeared only in the helper's closure, and
   * Reanimated collects dependencies from the style worklet's own closure
   * without traversing nested ones - so the styles stopped re-running and the
   * icons sat frozen on the previously selected tab.
   *
   * Scale only, no lift: the icon used to rise as the puck arrived, which
   * pushed the selected tab's contents - the one tab sitting inside the bubble
   * - off its centre line, 8.5pt above against 11.5pt below. Scale is safe
   * because it grows about the centre; translation is not.
   */
  const iconStyle = useAnimatedStyle(() => {
    const w = Math.max(0, 1 - Math.abs(mid.value - index));
    return { transform: [{ scale: press.value * (1 + w * 0.09 + pop.value * 0.2) }] };
  });

  /**
   * The pop on landing.
   *
   * A separate spring from everything else, and deliberately underdamped, so
   * it overshoots and settles back. The proximity-driven scale above cannot do
   * this: it tracks the bubble's position, so it can only ever arrive, never
   * overshoot.
   */
  useEffect(() => {
    if (!focused) return;
    pop.value = withSequence(
      withSpring(1, { damping: 7, stiffness: 280, mass: 0.5 }),
      withSpring(0, { damping: 13, stiffness: 170, mass: 0.8 })
    );
  }, [focused, pop]);

  /**
   * The lens.
   *
   * While the bubble is travelling, whatever it passes over is stretched
   * sideways and pulled towards its centre, the way content behind a moving
   * piece of glass is. Keyed off `spread` - the gap between the two springs -
   * so it is at full strength mid-flight and exactly zero once the shape
   * settles. `near` confines it to the tab the bubble is actually over.
   */
  const lensStyle = useAnimatedStyle(() => {
    const d = mid.value - index;
    const near = Math.max(0, 1 - Math.abs(d));
    const lens = near * spread.value;
    return {
      transform: [
        { translateX: d * 9 * lens },
        { scaleX: 1 + lens * 0.26 },
        { scaleY: 1 - lens * 0.13 },
      ],
    };
  });


  /**
   * Colour coming apart, while the glass is moving.
   *
   * Real glass does not bend every wavelength by the same amount, so anything
   * seen through a moving edge shows a colour fringe: red leaning one way,
   * blue the other, white where they still overlap. It is the thing that makes
   * a lens read as a lens rather than as a shape sliding about.
   *
   * Done by drawing the glyph twice more, tinted at the two ends of the
   * spectrum and pulled apart in opposite directions. Not a shader - React
   * Native has no blend modes to add channels with - but the separation is
   * what the eye actually reads, and at these sizes and for these few
   * milliseconds it is indistinguishable from the real thing.
   *
   * Both layers are keyed off the same `spread` the lens uses, so they are at
   * their widest mid-flight and at exactly zero, fully transparent, the moment
   * the puck settles. Nothing is tinted while anyone can look at it closely.
   */
  const redStyle = useAnimatedStyle(() => {
    const near = Math.max(0, 1 - Math.abs(mid.value - index));
    const lens = near * spread.value;
    return { opacity: lens * 0.55, transform: [{ translateX: lens * 3.2 }] };
  });

  const blueStyle = useAnimatedStyle(() => {
    const near = Math.max(0, 1 - Math.abs(mid.value - index));
    const lens = near * spread.value;
    return { opacity: lens * 0.55, transform: [{ translateX: -lens * 3.2 }] };
  });

  // Crossfade outline into filled instead of swapping glyphs. A swap is a
  // visible pop; the fade rides the same curve as the puck.
  const onStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, 1 - Math.abs(mid.value - index)),
  }));

  const offStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.max(0, 1 - Math.abs(mid.value - index)),
  }));

  const labelStyle = useAnimatedStyle(() => {
    const w = Math.max(0, 1 - Math.abs(mid.value - index));
    return {
      // No lift here either - see the note on iconStyle.
      opacity: 0.7 + w * 0.3,
      color: interpolateColor(w, [0, 1], [mutedColor, labelColor]),
    };
  });

  return (
    <Pressable
      style={styles.item}
      onPress={onPress}
      onPressIn={() => (press.value = withSpring(0.86, POP))}
      onPressOut={() => (press.value = withSpring(1, POP))}
      hitSlop={8}
    >
      <Animated.View style={[styles.content, lensStyle]}>
        <Animated.View style={[styles.iconBox, iconStyle]}>
          {/* The fringe sits under the glyph so the glyph itself stays crisp -
              what separates is the colour behind its edges, which is where a
              lens puts it. */}
          <Animated.View style={[styles.iconLayer, redStyle]} pointerEvents="none">
            {glyph(focused ? iconOn : iconOff, FRINGE_WARM)}
          </Animated.View>
          <Animated.View style={[styles.iconLayer, blueStyle]} pointerEvents="none">
            {glyph(focused ? iconOn : iconOff, FRINGE_COOL)}
          </Animated.View>

          <Animated.View style={[styles.iconLayer, offStyle]}>
            {glyph(iconOff, mutedColor)}
          </Animated.View>
          <Animated.View style={[styles.iconLayer, onStyle]}>
            {glyph(iconOn, color)}
          </Animated.View>
        </Animated.View>

        <Animated.Text style={[styles.label, labelStyle]} numberOfLines={1}>
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * Floating liquid tab bar.
 *
 * The puck is not a shape that moves - it is the span between two springs that
 * move at different rates. It stretches out of the tab you left, thins in the
 * middle, and gathers back up under the tab you picked.
 *
 * Item width is a constant, not a measurement. Measuring meant the puck could
 * not be drawn on the first frame and had to fade in, which is exactly the
 * stutter that made an earlier version feel unfinished.
 */
export function LiquidTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const colors = useColors();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const isDark = theme === "dark";

  // Only the tabs named above, in that order - never whatever the navigator
  // happens to hold.
  const tabs = TABS.map((t) => ({
    ...t,
    route: state.routes.find((r) => r.name === t.name),
  })).filter((t) => t.route);

  const activeName = state.routes[state.index]?.name;
  const activeIndex = Math.max(0, tabs.findIndex((t) => t.name === activeName));

  const lead = useSharedValue(activeIndex);
  const tail = useSharedValue(activeIndex);

  // Derived, not assigned inside a style worklet - a style is allowed to read
  // shared values, not write them, and writing there re-enters the mapper.
  const mid = useDerivedValue(() => (lead.value + tail.value) / 2);

  /**
   * How far apart the two springs currently are, 0 at rest.
   *
   * This is the bar's own measure of motion - the springs separate while the
   * bubble travels and close up when it lands - so the lens distortion and the
   * colour fringing below can key off it directly. Nothing has to know how long
   * the animation runs, and the effect can never be left switched on: if the
   * shape is not moving, the springs are together and this is zero.
   */
  const spread = useDerivedValue(() => Math.min(Math.abs(lead.value - tail.value) * 2.2, 1));


  useEffect(() => {
    lead.value = withSpring(activeIndex, LEAD);
    tail.value = withSpring(activeIndex, TAIL);
  }, [activeIndex, lead, tail]);

  /**
   * Transforms only - never left/width/height.
   *
   * Layout props set from a style worklet do not propagate on the UI thread,
   * so the puck sat frozen at whatever JS last rendered while the icons, which
   * are driven by transforms, animated correctly. The two disagreed on screen:
   * the shape under one tab, the lit icon under another.
   */
  const puckStyle = useAnimatedStyle(() => {
    const spread = Math.abs(lead.value - tail.value) * ITEM_W;

    // Volume is roughly conserved: the further the two ends are pulled apart,
    // the thinner the body between them gets. That trade is the entire reason
    // this reads as liquid and not as a rectangle being resized.
    const pull = Math.min(spread / ITEM_W, 1);

    return {
      transform: [
        // Scale is about the view's own centre, so anchoring at the midpoint
        // of the two springs makes the body stretch symmetrically between them.
        { translateX: ((lead.value + tail.value) / 2) * ITEM_W },
        { scaleX: (PUCK_W + spread) / PUCK_W },
        { scaleY: 1 - pull * 0.26 },
      ],
    };
  });

  /**
   * On iOS the blur is the surface; the tint only colours it.
   *
   * At 0.42 over a heavy blur the two stacked into something effectively
   * opaque - a dark grey slab. Glass needs the content behind it to still be
   * legible as shape and colour, which means a tint light enough to read
   * through and a blur soft enough not to erase what it is blurring.
   *
   * Android has no real backdrop blur, so transparency there is a hole rather
   * than glass. It keeps a dense tint.
   */
  const barTint = isDark
    ? IOS
      ? "rgba(20,20,24,0.12)"
      : "rgba(18,18,22,0.86)"
    : IOS
      ? "rgba(255,255,255,0.16)"
      : "rgba(250,250,250,0.9)";

  return (
    <View
      style={[styles.wrap, { paddingBottom: insets.bottom > 0 ? insets.bottom - 6 : 16 }]}
      pointerEvents="box-none"
    >
      <View style={styles.shadow}>
        <View
          style={[
            styles.bar,
            {
              width: tabs.length * ITEM_W + BAR_PAD_X * 2,
              borderColor: isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.07)",
              backgroundColor: barTint,
            },
          ]}
        >
          {IOS && (
            <BlurView
              // Low on purpose. Heavy blur smears the backdrop into a grey
              // mass - the result looks blurry, which is not the same as
              // glass. Glass is something you see through: the row behind
              // should stay recognisable, just softened and pushed back.
              intensity={16}
              tint={isDark ? "dark" : "light"}
              style={styles.barFill}
            />
          )}

          {/* Specular sheen: light catching the top curve of the glass. Faint -
              it is a highlight on the surface, and any heavier it becomes
              another layer of fill and puts the opacity straight back. */}
          <LinearGradient
            colors={
              isDark
                ? ["rgba(255,255,255,0.10)", "rgba(255,255,255,0.02)", "rgba(0,0,0,0.05)"]
                : ["rgba(255,255,255,0.55)", "rgba(255,255,255,0.14)", "rgba(0,0,0,0.03)"]
            }
            locations={[0, 0.5, 1]}
            style={styles.barFill}
            pointerEvents="none"
          />

          {/* The lit top edge. This is the strongest glass cue there is - a
              pane reads as glass because light catches its rim, far more than
              because of anything happening across its face. Brightest in the
              middle, falling off at the ends, as a curved edge would. */}
          <LinearGradient
            colors={[
              "rgba(255,255,255,0)",
              isDark ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.95)",
              "rgba(255,255,255,0)",
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.topEdge}
            pointerEvents="none"
          />

          {/* Absolute child of the bar, not of the row: Yoga measures insets
              from the parent's padding box, so a padded row would silently
              offset every position by PAD. */}
          {/* Two views, deliberately.
              The wrapper carries the transform and nothing else; the face
              carries the shape and nothing else. Putting both on one view left
              the corners rendering hard on screen no matter what radius was
              set - an animated transform and a corner radius on the same view
              do not survive together on iOS. Split, the face is never
              transformed, so its radius is an ordinary static one. */}
          <Animated.View style={[styles.puck, puckStyle]} pointerEvents="none">
            <View
              style={[
                styles.puckFace,
                {
                  // Just enough rim to catch the edge; a bright one would put
                  // back the white the dark fill is meant to remove.
                  borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.07)",
                  backgroundColor: isDark ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.08)",
                },
              ]}
            />
          </Animated.View>

          <View style={styles.row}>
            {tabs.map((tab, i) => {
              const route = tab.route!;
              const { options } = descriptors[route.key];
              const focused = activeName === route.name;
              const label = typeof options.title === "string" ? options.title : route.name;

              return (
                <TabItem
                  key={route.key}
                  index={i}
                  mid={mid}
                  spread={spread}
                  focused={focused}
                  label={label}
                  iconOn={tab.on}
                  iconOff={tab.off}
                  image={tab.image}
                  color={colors.primary}
                  labelColor={colors.foreground}
                  mutedColor={colors.mutedForeground}
                  onPress={() => {
                    const event = navigation.emit({
                      type: "tabPress",
                      target: route.key,
                      canPreventDefault: true,
                    });
                    if (focused || event.defaultPrevented) return;
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    navigation.navigate(route.name, route.params);
                  }}
                />
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // box-none so the space around the bar does not swallow taps meant for the
  // screen behind it.
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
  },
  // The shadow lives outside the clipping view - overflow: hidden on the bar
  // would cut it off.
  shadow: {
    borderRadius: BAR_H / 2,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  bar: {
    height: BAR_H,
    borderRadius: BAR_H / 2,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  // Rounded themselves, not relying on the bar to clip them. A parent radius
  // does not clip a BlurView or a gradient on iOS, so the glass filled square
  // into the corners and only the hairline border followed the curve.
  barFill: { ...StyleSheet.absoluteFillObject, borderRadius: BAR_H / 2 },
  // Inset from the ends so the highlight sits on the flat of the top curve
  // rather than running off round the sides.
  topEdge: { position: "absolute", top: 0, left: "14%", right: "14%", height: 1 },
  row: { flex: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: BAR_PAD_X },
  /**
   * One view, one flat colour, no children.
   *
   * It held a gradient fill and a moving highlight, both clipped by
   * overflow:hidden. Between the clip being unreliable on a transformed view
   * and the highlight sitting on top of the fill, the bubble rendered lighter
   * than the bar it sits in - the opposite of what the colours say. A solid
   * background on a plain view has none of those failure modes: the radius
   * always renders, and the colour on screen is the colour in the file.
   */
  // Placement and transform only - no radius, no background, no border.
  puck: {
    position: "absolute",
    left: BAR_PAD_X + (ITEM_W - PUCK_W) / 2,
    top: PAD,
    width: PUCK_W,
    height: PUCK_H,
  },
  // Shape only, on a view that is never transformed.
  puckFace: {
    flex: 1,
    borderRadius: PUCK_R,
    borderWidth: StyleSheet.hairlineWidth,
  },
  item: { width: ITEM_W, height: PUCK_H, alignItems: "center", justifyContent: "center" },
  // The lens distorts this, not the Pressable - a transformed touch target
  // would move the tap area with it.
  content: { alignItems: "center", justifyContent: "center", gap: 2 },
  iconBox: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  // Matches the glyph size so the house sits on the same optical grid as the
  // other two icons.
  iconImage: { width: ICON, height: ICON, resizeMode: "contain" },
  iconLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 10,
    lineHeight: 13,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.1,
  },
});
