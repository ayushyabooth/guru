/**
 * NexusSphere — the 3D-sphere dot that sits in the center of the Triskelion
 * when all three rings have progress. Pulses + emits an outward halo when
 * `celebrate` is true (Over-Goal Celebration).
 *
 * Source: Figma `Rings / Over-Goal Celebration` (79:254).
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

const ACircle = Animated.createAnimatedComponent(Circle);

export interface NexusSphereProps {
  size: number;
  celebrate?: boolean;
  reducedMotion?: boolean;
}

function prefersReducedMotion(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function NexusSphere({ size, celebrate = false, reducedMotion }: NexusSphereProps) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!celebrate || reducedMotion || prefersReducedMotion()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [celebrate, reducedMotion, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1.0, 1.25] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 0.7, 0.3] });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="nex" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <Stop offset="40%" stopColor="#ffffff" stopOpacity="0.9" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
            <Stop offset="60%" stopColor="#ffffff" stopOpacity="0.08" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {/* Halo — animates when celebrating */}
        {celebrate && (
          <ACircle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#halo)" opacity={haloOpacity as any} />
        )}
        {/* Core sphere */}
        <Circle cx={size / 2} cy={size / 2} r={size * 0.35} fill="url(#nex)" />
      </Svg>
    </View>
  );
}

export default NexusSphere;
