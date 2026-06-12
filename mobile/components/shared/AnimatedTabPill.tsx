/**
 * Animated tab pill — the "liquid glass slider" from GUR-137.
 *
 * Renders a 48x44 rounded pill that slides between tabs with a spring
 * animation, replacing the per-icon bloom disc from GUR-98. Reads the active
 * route index from the React Navigation tab state and animates translateX to
 * the matching tab slot. The pill fill shifts to the accent color of the
 * active tab (indigo · blue · pink · orange), keeping the rest of the glass
 * island chrome untouched.
 *
 * Mounted via `tabBarBackground` so it paints BEHIND the tab buttons but ON
 * TOP of the bar's base glass fill.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { useNavigationState } from '@react-navigation/native';

// GUR-137: pill covers icon + label.
// Bar = 64px. The Home tab uses a Triskelion whose canvas is ~48px wide
// (size 28 + 10px glow padding on each side) — so the top ring protrudes
// ~10px above the icon's nominal 28px box. A short pill clipped that.
// Make the pill span almost the full bar (top=2, height=60) so the pill
// fully wraps the Triskelion's glow padding AND the icon+label stack.
const PILL_WIDTH = 72;
const PILL_HEIGHT = 60;
const PILL_RADIUS = 22;
const PILL_TOP = 2;

// Spring tuned to match the filter-pill transition spec in GUR-132 (mass:1,
// stiffness:280, damping:24). RN's Animated.spring maps to roughly equivalent
// tension/friction values.
const SPRING_TENSION = 160;
const SPRING_FRICTION = 14;

// Accent per tab — keep in sync with the tabBarIcon colors in app/(tabs)/_layout.tsx.
const TAB_ACCENTS: Record<string, string> = {
  index: '#6366F1',    // Home
  catchup: '#38BDF8',
  guru: '#818CF8',     // agent organism
  divein: '#EC4899',
  recap: '#FB923C',
};
const FALLBACK_ACCENT = '#6366F1';

// R16 (founder): the guru tab's pill is the organism's HOUSE — noticeably
// bigger than the standard pill, springing smoothly between the two sizes as
// focus moves. It emphasizes the agent as the lynchpin of the app.
const GURU_PILL_WIDTH = 96;

interface Props {
  isDark: boolean;
  /** Inner horizontal padding of the tab bar container — pill never crosses it. */
  horizontalPadding?: number;
}

export default function AnimatedTabPill({ isDark, horizontalPadding = 0 }: Props) {
  // Read the active index from the tab navigator. Hook returns undefined on
  // first paint before the navigator mounts — guard against that.
  const state = useNavigationState((s) => s);
  const routes = state?.routes ?? [];
  const index = state?.index ?? 0;
  const activeName = routes[index]?.name ?? 'index';
  const accent = TAB_ACCENTS[activeName] ?? FALLBACK_ACCENT;

  const [bar, setBar] = useState({ w: 0, h: 0 });
  const barWidth = bar.w;
  const tabCount = Math.max(routes.length, 1);
  const tabWidth = barWidth / tabCount;

  const isGuru = activeName === 'guru';

  // R16: the icon+label stack sits HIGH in the (now 72px) bar, so a vertically
  // centered pill read as "lots of padding below the icon, barely any on top".
  // Hug the content instead: small fixed top inset. The guru pill is taller —
  // it houses the organism, reaching nearly the full bar.
  const stdHeight = bar.h > 0 ? Math.min(58, Math.max(46, bar.h - 16)) : PILL_HEIGHT;
  const pillHeight = isGuru ? (bar.h > 0 ? Math.max(60, bar.h - 6) : 66) : stdHeight;
  const pillTop = isGuru ? 3 : 4;
  const pillWidth = isGuru ? GURU_PILL_WIDTH : PILL_WIDTH;

  // Center the pill on the active tab: pill.left = tab.center - pillWidth/2
  const targetX = useMemo(
    () => (barWidth > 0 ? horizontalPadding + tabWidth * index + (tabWidth - pillWidth) / 2 : 0),
    [barWidth, tabWidth, index, horizontalPadding, pillWidth],
  );

  const animX = useRef(new Animated.Value(targetX)).current;
  const animW = useRef(new Animated.Value(PILL_WIDTH)).current;
  const animH = useRef(new Animated.Value(PILL_HEIGHT)).current;
  const animTop = useRef(new Animated.Value(PILL_TOP)).current;

  useEffect(() => {
    // Slide AND morph the pill to the active tab once the bar width is known.
    // Size/position are layout props, so the whole group runs on the JS driver
    // (this is a web-first surface; the spring stays smooth). The opacity fade
    // was removed: useNativeDriver opacity isn't reliable on react-native-web —
    // opacity is a static value gated on barWidth (below).
    if (barWidth === 0) return;
    const spring = (v: Animated.Value, to: number) =>
      Animated.spring(v, { toValue: to, tension: SPRING_TENSION, friction: SPRING_FRICTION, useNativeDriver: false });
    Animated.parallel([
      spring(animX, targetX),
      spring(animW, pillWidth),
      spring(animH, pillHeight),
      spring(animTop, pillTop),
    ]).start();
  }, [targetX, barWidth, pillWidth, pillHeight, pillTop]);

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => setBar({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      <Animated.View
        style={[
          styles.pill,
          {
            opacity: barWidth > 0 ? 1 : 0,
            top: animTop,
            height: animH,
            width: animW,
            transform: [{ translateX: animX }],
            // Base fill is the accent at ~28%/22% — the vertical gradient on
            // web stacks an extra highlight on top for the 3D read.
            backgroundColor: isDark
              ? `${accent}66`
              : `${accent}4D`,
            borderColor: isDark
              ? `${accent}A3`
              : `${accent}80`,
            // Web gets the full glass recipe: vertical gradient (bright top,
            // faded bottom) layered over the fill, strong inset highlight,
            // bottom inset shadow, outer glow, and a drop shadow underneath
            // for lift. Together these give the "3D glassmorphic" depth.
            ...(Platform.OS === 'web'
              ? ({
                  backdropFilter: 'blur(20px) saturate(190%)',
                  WebkitBackdropFilter: 'blur(20px) saturate(190%)',
                  // Linear-gradient layer stacked above the accent fill.
                  // The gradient is color-only; transparency lets the accent
                  // fill show through.
                  backgroundImage: isDark
                    ? `linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.06) 35%, rgba(255,255,255,0) 70%, rgba(0,0,0,0.10) 100%)`
                    : `linear-gradient(180deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.35) 40%, rgba(255,255,255,0.10) 75%, rgba(15,23,42,0.04) 100%)`,
                  boxShadow: [
                    // Outer drop shadow for lift (kept tight so the glow does
                    // not spill below the glass island)
                    `0 3px 12px ${accent}5C`,
                    `0 2px 6px ${isDark ? 'rgba(0,0,0,0.45)' : 'rgba(15,23,42,0.18)'}`,
                    // Inner top highlight (specular edge)
                    `inset 0 1.5px 0 ${isDark ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.95)'}`,
                    // Inner bottom shadow (concave lip)
                    `inset 0 -1.5px 2px ${isDark ? 'rgba(0,0,0,0.20)' : 'rgba(15,23,42,0.10)'}`,
                    // Soft inner glow on the left/right edges
                    `inset 1px 0 0 ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.45)'}`,
                    `inset -1px 0 0 ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.45)'}`,
                  ].join(', '),
                } as any)
              : {
                  shadowColor: accent,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.35,
                  shadowRadius: 14,
                  elevation: 6,
                }),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    // Top-anchored (not centered) — see PILL_TOP rationale.
    top: PILL_TOP,
    left: 0,
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: PILL_RADIUS,
    borderWidth: 1,
  },
});
