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
  divein: '#EC4899',
  recap: '#FB923C',
};
const FALLBACK_ACCENT = '#6366F1';

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

  const [barWidth, setBarWidth] = useState(0);
  const tabCount = Math.max(routes.length, 1);
  const tabWidth = barWidth / tabCount;

  // Center the pill on the active tab: pill.left = tab.center - PILL_WIDTH/2
  const targetX = useMemo(
    () => (barWidth > 0 ? horizontalPadding + tabWidth * index + (tabWidth - PILL_WIDTH) / 2 : 0),
    [barWidth, tabWidth, index, horizontalPadding],
  );

  const translateX = useRef(new Animated.Value(targetX)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in once we know the bar width; skip the animation on first paint
    // so the pill starts at the right slot instead of sliding from 0.
    if (barWidth === 0) return;
    Animated.parallel([
      Animated.spring(translateX, {
        toValue: targetX,
        tension: SPRING_TENSION,
        friction: SPRING_FRICTION,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [targetX, barWidth]);

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View
        style={[
          styles.pill,
          {
            opacity,
            transform: [{ translateX }],
            // Base fill is the accent at ~28%/22% — the vertical gradient on
            // web stacks an extra highlight on top for the 3D read.
            backgroundColor: isDark
              ? `${accent}47`
              : `${accent}38`,
            borderColor: isDark
              ? `${accent}7A`
              : `${accent}52`,
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
                    // Outer drop shadow for lift
                    `0 6px 18px ${accent}55`,
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
