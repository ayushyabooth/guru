/**
 * GlassView — the single glass primitive for the v2 EDL materials system.
 *
 * Renders any of the 5 Materials Hierarchy tiers (ultraThin → chrome) with the
 * correct blur, opacity, border, and shadow recipe for the current theme mode.
 * On web, uses CSS backdrop-filter (via expo-blur's web bridge if available, or
 * a direct style fallback). On native, uses expo-blur's BlurView.
 *
 * See Figma `Glass / Materials Hierarchy` (77:3) for the source of truth.
 */

import React from 'react';
import { Platform, StyleProp, View, ViewProps, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../contexts/ThemeContext';
import {
  GlassMaterialsV2,
  GlassTier,
  BorderRadius,
  getGlassStyle,
} from '../../constants/liquidGlass';

export interface GlassViewProps extends ViewProps {
  /** Which material tier. Default `regular`. */
  tier?: GlassTier;
  /** Border radius. Default `BorderRadius.lg` (16). */
  radius?: number;
  /** Optional colored glow behind the glass (hex without alpha). */
  tint?: string;
  /** Force a specific mode; otherwise follow ThemeContext. */
  mode?: 'dark' | 'light';
  /** Additional style merged after the tier recipe. */
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function GlassView({
  tier = 'regular',
  radius = BorderRadius.lg,
  tint,
  mode: forcedMode,
  style,
  children,
  ...rest
}: GlassViewProps) {
  const { mode: ctxMode } = useTheme();
  const mode = forcedMode ?? ctxMode;
  const t = GlassMaterialsV2[tier];
  const base = getGlassStyle(tier, mode, tint);

  // Inner highlight (top edge specular) is achieved via an absolutely positioned
  // thin line inside the glass. Simpler than fighting multi-shadow on RN Web.
  const highlightOpacity = mode === 'dark' ? t.innerHighlightDark : t.innerHighlightLight;

  // Tint glow: a drop-shadow in the filter color, only on web where boxShadow
  // chains are cheap. On native we leave the black depth shadow from `base`.
  const webTintBoxShadow =
    Platform.OS === 'web' && tint
      ? { boxShadow: `0 ${t.shadowY / 2}px ${t.shadowBlur}px 0 ${hexToRgba(tint, 0.22)}, 0 ${t.shadowY}px ${t.shadowBlur}px 0 rgba(0,0,0,${mode === 'dark' ? 0.35 : 0.08})` as any }
      : undefined;

  const composedStyle: StyleProp<ViewStyle> = [
    base,
    { borderRadius: radius, overflow: 'hidden' },
    webTintBoxShadow as ViewStyle | undefined,
    style,
  ];

  // On web, BlurView is emulated via CSS backdrop-filter. On native, use the
  // platform BlurView for a real gaussian pass.
  if (Platform.OS === 'web') {
    // Web path: direct style with backdropFilter
    const webStyle: any = {
      backdropFilter: `blur(${t.blur}px) saturate(180%)`,
      WebkitBackdropFilter: `blur(${t.blur}px) saturate(180%)`,
    };
    return (
      <View {...rest} style={[composedStyle, webStyle]}>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 1.5,
            backgroundColor: `rgba(255,255,255,${highlightOpacity})`,
          }}
        />
        {children}
      </View>
    );
  }

  return (
    <BlurView
      intensity={Math.min(100, t.blur * 1.8)}
      tint={mode === 'dark' ? 'dark' : 'light'}
      style={composedStyle as ViewStyle}
      {...rest}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 1.5,
          backgroundColor: `rgba(255,255,255,${highlightOpacity})`,
        }}
      />
      {children}
    </BlurView>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export default GlassView;
