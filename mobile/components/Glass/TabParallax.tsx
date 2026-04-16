/**
 * TabParallax — wraps a tab's content and animates on route change.
 *
 * Topic-1 behavior: when the active tab changes, content slides on parallel
 * Z-planes. Background dims 8%, foreground lifts, chrome stays pinned. This
 * component only owns the FOREGROUND animation (chrome is the tab bar itself
 * and never mounts here).
 *
 * Usage:
 *   <TabParallax routeKey={pathname}>
 *     <MyTabScreen />
 *   </TabParallax>
 *
 * The `routeKey` change triggers the slide-in animation.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet } from 'react-native';

interface TabParallaxProps {
  routeKey: string;
  children: React.ReactNode;
}

function prefersReducedMotion(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function TabParallax({ routeKey, children }: TabParallaxProps) {
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // When the route key changes, reset to 0 and animate in.
    progress.setValue(0);
    const run = prefersReducedMotion()
      ? Animated.timing(progress, { toValue: 1, duration: 120, useNativeDriver: true })
      : Animated.timing(progress, {
          toValue: 1,
          duration: 400,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        });
    run.start();
  }, [routeKey, progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });
  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] });

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { transform: [{ translateY }, { scale }], opacity },
      ]}
    >
      {children}
    </Animated.View>
  );
}
