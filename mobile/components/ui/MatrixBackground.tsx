/**
 * MatrixBackground — Dark ambient glow background
 *
 * Dark radial gradient base with 2-3 soft glow orbs.
 * The dark canvas makes glass effects shine.
 *
 * Variants control which glow colors dominate:
 * - home: balanced blue/pink/orange
 * - catchup: sky blue dominant
 * - divein: magenta dominant
 * - recap: coral orange dominant
 * - auth: sky blue dominant (login/onboarding)
 */

import React from 'react';
import { View, StyleSheet, Dimensions, Platform } from 'react-native';
import Svg, {
  Defs,
  RadialGradient,
  Stop,
  Rect,
  Circle,
} from 'react-native-svg';

const { width: SW, height: SH } = Dimensions.get('window');

interface MatrixBackgroundProps {
  variant?: 'home' | 'catchup' | 'divein' | 'recap' | 'auth';
}

// Glow orb configurations by variant
const VARIANT_ORBS: Record<string, Array<{
  cx: string; cy: string; r: string;
  color: string; opacity: number;
}>> = {
  home: [
    { cx: '20%', cy: '15%', r: '35%', color: '#38BDF8', opacity: 0.17 },
    { cx: '75%', cy: '40%', r: '30%', color: '#EC4899', opacity: 0.14 },
    { cx: '40%', cy: '80%', r: '28%', color: '#FB923C', opacity: 0.11 },
  ],
  catchup: [
    { cx: '25%', cy: '20%', r: '40%', color: '#38BDF8', opacity: 0.21 },
    { cx: '80%', cy: '50%', r: '25%', color: '#7DD3FC', opacity: 0.14 },
    { cx: '50%', cy: '85%', r: '22%', color: '#EC4899', opacity: 0.08 },
  ],
  divein: [
    { cx: '70%', cy: '20%', r: '35%', color: '#EC4899', opacity: 0.21 },
    { cx: '20%', cy: '55%', r: '28%', color: '#F472B6', opacity: 0.14 },
    { cx: '60%', cy: '80%', r: '22%', color: '#38BDF8', opacity: 0.08 },
  ],
  recap: [
    { cx: '50%', cy: '25%', r: '35%', color: '#FB923C', opacity: 0.20 },
    { cx: '20%', cy: '60%', r: '25%', color: '#FDBA74', opacity: 0.11 },
    { cx: '80%', cy: '75%', r: '22%', color: '#EC4899', opacity: 0.08 },
  ],
  auth: [
    { cx: '30%', cy: '25%', r: '40%', color: '#38BDF8', opacity: 0.20 },
    { cx: '75%', cy: '35%', r: '28%', color: '#EC4899', opacity: 0.14 },
    { cx: '45%', cy: '80%', r: '25%', color: '#FB923C', opacity: 0.10 },
  ],
};

export default function MatrixBackground({ variant = 'home' }: MatrixBackgroundProps) {
  const orbs = VARIANT_ORBS[variant] || VARIANT_ORBS.home;

  return (
    <View style={styles.container} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          {/* Base dark radial gradient */}
          <RadialGradient id="matrixBase" cx="50%" cy="40%" r="70%">
            <Stop offset="0%" stopColor="#0F1420" />
            <Stop offset="60%" stopColor="#0A0E17" />
            <Stop offset="100%" stopColor="#060911" />
          </RadialGradient>

          {/* Glow orb gradients */}
          {orbs.map((orb, i) => (
            <RadialGradient
              key={`glow${i}`}
              id={`glow${i}`}
              cx={orb.cx}
              cy={orb.cy}
              r={orb.r}
            >
              <Stop offset="0%" stopColor={orb.color} stopOpacity={orb.opacity} />
              <Stop offset="50%" stopColor={orb.color} stopOpacity={orb.opacity * 0.4} />
              <Stop offset="100%" stopColor={orb.color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>

        {/* Base dark fill */}
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#matrixBase)" />

        {/* Glow orbs */}
        {orbs.map((_, i) => (
          <Rect
            key={`orbRect${i}`}
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill={`url(#glow${i})`}
          />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
});
