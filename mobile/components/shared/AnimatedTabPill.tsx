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

// GUR-137: pill covers icon + label (not just the icon). Tab bar is 64px tall
// with the label flush to the bottom — pill extends from just above the icon
// down past the label so both sit inside the glass surface. Width is tight
// enough that the bar's outer border still reads around each slot.
const PILL_WIDTH = 72;
const PILL_HEIGHT = 54;
const PILL_RADIUS = 18;

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
            // Stronger fill than the first draft — the tab bar already sits on
            // its own blur layer, so a faint tint disappeared into it. Bump
            // to ~28% dark / 22% light so the pill reads as a discrete glass
            // element, not a vague glow.
            backgroundColor: isDark
              ? `${accent}47` // ~28% alpha on dark
              : `${accent}38`, // ~22% on light
            borderColor: isDark
              ? `${accent}7A` // ~48% border on dark
              : `${accent}52`, // ~32% on light
            // Web-only glass blur + glow + inner top highlight (gives the
            // floating-glass depth called for in the GUR-137 spec).
            ...(Platform.OS === 'web'
              ? {
                  backdropFilter: 'blur(16px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(16px) saturate(180%)',
                  boxShadow: [
                    `0 0 18px ${accent}40`,
                    `inset 0 1px 0 ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.85)'}`,
                    `inset 0 -1px 0 ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.06)'}`,
                  ].join(', '),
                }
              : {
                  shadowColor: accent,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.3,
                  shadowRadius: 12,
                  elevation: 4,
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
    // Nudge 1px below vertical center — the icon sits slightly above the
    // label, so a centered pill looks low. Pushing the pill down by 1px
    // visually balances it around the icon+label column.
    top: (64 - PILL_HEIGHT) / 2 + 1,
    left: 0,
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: PILL_RADIUS,
    borderWidth: 1,
  },
});
