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

// GUR-137: 48x44 pill, 20px radius. Tighter fit than the bar (64px) so the
// bar's glass border still reads around each tab.
const PILL_WIDTH = 48;
const PILL_HEIGHT = 44;
const PILL_RADIUS = 20;

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
            backgroundColor: isDark
              ? `${accent}29` // ~16% alpha on dark
              : `${accent}1F`, // ~12% on light
            borderColor: isDark
              ? `${accent}52` // ~32% border on dark
              : `${accent}33`, // ~20% on light
            // Web-only glass blur + glow; native gets a subtle shadow.
            ...(Platform.OS === 'web'
              ? {
                  backdropFilter: 'blur(14px) saturate(160%)',
                  WebkitBackdropFilter: 'blur(14px) saturate(160%)',
                  boxShadow: `0 0 14px ${accent}33, inset 0 1px 0 ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.7)'}`,
                }
              : {
                  shadowColor: accent,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.25,
                  shadowRadius: 10,
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
    top: (64 - PILL_HEIGHT) / 2, // Vertically center inside the 64px bar
    left: 0,
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: PILL_RADIUS,
    borderWidth: 1,
  },
});
