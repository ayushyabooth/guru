/**
 * useTapRipple — 1A Ripple-Refract tap micro-feedback for glass surfaces.
 *
 * Returns press handlers + a render function for the <RippleLayer/> that the
 * caller should absolutely-position inside their glass container. The layer
 * renders a white semi-transparent circle that expands from the tap point over
 * 200–350ms, following Topic-1's "Ripple-Refract" direction.
 *
 * Respects prefers-reduced-motion: no animation, just a quick opacity flash.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Animated, Easing, GestureResponderEvent, Platform, StyleSheet, View } from 'react-native';

export interface RippleState {
  id: number;
  x: number;
  y: number;
  anim: Animated.Value;
}

function prefersReducedMotion(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useTapRipple(opts: { color?: string; durationMs?: number } = {}) {
  const color = opts.color ?? 'rgba(255,255,255,0.35)';
  const duration = opts.durationMs ?? 280;
  const [ripples, setRipples] = useState<RippleState[]>([]);
  const idRef = useRef(0);

  const onPressIn = useCallback(
    (e: GestureResponderEvent) => {
      const id = ++idRef.current;
      const { locationX, locationY } = e.nativeEvent;
      const anim = new Animated.Value(0);
      setRipples((prev) => [...prev, { id, x: locationX, y: locationY, anim }]);
      const run = prefersReducedMotion()
        ? Animated.timing(anim, { toValue: 1, duration: 120, useNativeDriver: true })
        : Animated.timing(anim, {
            toValue: 1,
            duration,
            easing: Easing.bezier(0.4, 0, 0.2, 1),
            useNativeDriver: true,
          });
      run.start(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      });
    },
    [duration]
  );

  const RippleLayer = useCallback(
    ({ maxSize = 160 }: { maxSize?: number }) => (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {ripples.map((r) => {
          const scale = r.anim.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 1],
          });
          const opacity = r.anim.interpolate({
            inputRange: [0, 0.2, 1],
            outputRange: [0, 0.6, 0],
          });
          return (
            <Animated.View
              key={r.id}
              style={{
                position: 'absolute',
                left: r.x - maxSize / 2,
                top: r.y - maxSize / 2,
                width: maxSize,
                height: maxSize,
                borderRadius: maxSize / 2,
                backgroundColor: color,
                opacity,
                transform: [{ scale }],
              }}
            />
          );
        })}
      </View>
    ),
    [color, ripples]
  );

  return { onPressIn, RippleLayer };
}
