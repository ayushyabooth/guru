/**
 * AppBackground — sleek, theme-aligned ambient background used app-wide.
 *
 * Replaces the clunky OrganicBackground / MatrixBackground layers that were
 * being stamped per-screen. Mounted once at the root layout so every screen
 * inherits visual coherence.
 *
 * Design lives in Figma: file 7sgEGG13BI0Vksrg4hzpoQ, page "🌌 AppBackground v1"
 * (frames 83:5 dark, 83:12 light).
 *
 * Structure (identical in dark + light, only opacities + base color differ):
 *   1. Base SOLID fill  — dark #0A0E17 / light #F8FAFC
 *   2. 3 brand orbs      — Catch-up top-left, Dive-in bottom-right, Recap mid-left
 *   3. 1 interactive orb — soft indigo haze behind content for depth
 *   4. Edge vignette     — anchors content; dark=black fade, light=cool-gray fade
 */
import React from 'react';
import { View, StyleSheet, Dimensions, Platform } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Rect, Ellipse } from 'react-native-svg';
import { useTheme } from '../../contexts/ThemeContext';

const BRAND = {
  catchup: '#38BDF8',
  divein: '#EC4899',
  recap: '#FB923C',
  interactive: '#6366F1',
};

type Orb = {
  cxPct: number; // position as percent of width
  cyPct: number; // position as percent of height
  rPct: number;  // radius as percent of width
  color: string;
  opacity: number;
};

const DARK_ORBS: Orb[] = [
  { cxPct: 0.10, cyPct: 0.14, rPct: 0.90, color: BRAND.catchup,     opacity: 0.18 },
  { cxPct: 0.92, cyPct: 0.78, rPct: 1.10, color: BRAND.divein,      opacity: 0.16 },
  { cxPct: 0.08, cyPct: 0.70, rPct: 0.80, color: BRAND.recap,       opacity: 0.10 },
  { cxPct: 0.50, cyPct: 0.50, rPct: 1.10, color: BRAND.interactive, opacity: 0.06 },
];

const LIGHT_ORBS: Orb[] = [
  { cxPct: 0.08, cyPct: 0.14, rPct: 0.90, color: BRAND.catchup,     opacity: 0.10 },
  { cxPct: 0.94, cyPct: 0.80, rPct: 1.10, color: BRAND.divein,      opacity: 0.10 },
  { cxPct: 0.10, cyPct: 0.70, rPct: 0.80, color: BRAND.recap,       opacity: 0.07 },
  { cxPct: 0.50, cyPct: 0.50, rPct: 1.10, color: BRAND.interactive, opacity: 0.05 },
];

export default function AppBackground() {
  const { isDark } = useTheme();
  const { width, height } = Dimensions.get('window');
  const orbs = isDark ? DARK_ORBS : LIGHT_ORBS;
  const baseColor = isDark ? '#0A0E17' : '#F8FAFC';
  const vignetteColor = isDark ? '#000000' : '#E2E8F0';
  const vignetteOpacity = isDark ? 0.25 : 0.4;

  // On web we can use CSS radial-gradients which are GPU-accelerated and
  // render much more smoothly than SVG radial gradients at large sizes.
  if (Platform.OS === 'web') {
    const webOrbs = orbs.map((o) => {
      const pct = Math.round(o.opacity * 100);
      return `radial-gradient(circle at ${o.cxPct * 100}% ${o.cyPct * 100}%, ${o.color}${toHexOpacity(o.opacity)} 0%, transparent ${o.rPct * 60}%)`;
    }).join(', ');
    const vignettePct = Math.round(vignetteOpacity * 100);
    const fullBg = `${webOrbs}, radial-gradient(ellipse at center, transparent 55%, ${vignetteColor}${toHexOpacity(vignetteOpacity)} 100%), ${baseColor}`;
    return (
      <View
        pointerEvents="none"
        // @ts-expect-error web-only style
        style={[styles.container, { backgroundImage: fullBg, backgroundColor: baseColor }]}
      />
    );
  }

  // Native: SVG radial gradients
  return (
    <View style={styles.container} pointerEvents="none">
      <Svg width={width} height={height} style={StyleSheet.absoluteFillObject}>
        <Defs>
          {orbs.map((orb, i) => (
            <RadialGradient
              key={`orb-grad-${i}`}
              id={`orb-${i}`}
              cx={`${orb.cxPct * 100}%`}
              cy={`${orb.cyPct * 100}%`}
              r={`${orb.rPct * 60}%`}
              fx={`${orb.cxPct * 100}%`}
              fy={`${orb.cyPct * 100}%`}
            >
              <Stop offset="0%" stopColor={orb.color} stopOpacity={orb.opacity} />
              <Stop offset="100%" stopColor={orb.color} stopOpacity={0} />
            </RadialGradient>
          ))}
          <RadialGradient id="vignette" cx="50%" cy="50%" r="70%" fx="50%" fy="50%">
            <Stop offset="55%" stopColor={vignetteColor} stopOpacity={0} />
            <Stop offset="100%" stopColor={vignetteColor} stopOpacity={vignetteOpacity} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={baseColor} />
        {orbs.map((_, i) => (
          <Rect key={`orb-rect-${i}`} x={0} y={0} width={width} height={height} fill={`url(#orb-${i})`} />
        ))}
        <Rect x={0} y={0} width={width} height={height} fill="url(#vignette)" />
      </Svg>
    </View>
  );
}

function toHexOpacity(opacity: number): string {
  const v = Math.max(0, Math.min(255, Math.round(opacity * 255)));
  return v.toString(16).padStart(2, '0').toUpperCase();
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: -1,
  },
});
