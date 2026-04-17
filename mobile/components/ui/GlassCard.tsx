/**
 * GlassCard - Frosted glass card component
 *
 * A reusable card with liquid glass aesthetic.
 * Features:
 * - Translucent background with backdrop blur effect
 * - Subtle border and inner glow
 * - Multi-layer shadow for depth
 * - Optional tint based on filter context
 * - Dark/light theme support via ThemeContext
 *
 * Platform behaviour:
 * - Web: CSS backdrop-filter (existing approach)
 * - Native: expo-blur BlurView with an rgba overlay on top
 *
 * Accessibility:
 * - Respects "Reduce Transparency" system setting:
 *   raises opacity to 0.92 and disables blur
 */

import React from 'react';
import {
  View,
  StyleSheet,
  ViewStyle,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import {
  GlassMaterials,
  DarkGlassMaterials,
  getPalette,
  Spacing,
} from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';
import { useReduceTransparency } from '../../hooks/useReduceTransparency';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: 'standard' | 'heavy' | 'light' | 'pill';
  filterContext?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  blurIntensity?: number;
  glowColor?: string;
  glowIntensity?: 'none' | 'subtle' | 'medium' | 'strong';
}

// Blur intensity per variant (maps to expo-blur 0–100 scale)
const VARIANT_BLUR: Record<string, number> = {
  light: 20,
  pill: 35,
  standard: 50,
  heavy: 65,
};

export default function GlassCard({
  children,
  style,
  variant = 'standard',
  filterContext,
  padding = 'lg',
  blurIntensity: blurIntensityProp,
  glowColor,
  glowIntensity = 'none',
}: GlassCardProps) {
  const { isDark } = useTheme();
  const reduceTransparency = useReduceTransparency();
  const palette = getPalette(filterContext);
  const materials = isDark ? DarkGlassMaterials : GlassMaterials;

  // Get base material style
  const getMaterialStyle = (): ViewStyle => {
    switch (variant) {
      case 'heavy':
        return materials.cardHeavy;
      case 'light':
        return materials.cardLight;
      case 'pill':
        return materials.pill;
      default:
        return materials.card;
    }
  };

  // Get padding value
  const getPadding = (): number => {
    switch (padding) {
      case 'none':
        return 0;
      case 'sm':
        return Spacing.sm;
      case 'md':
        return Spacing.md;
      case 'lg':
        return Spacing.lg;
      case 'xl':
        return Spacing.xl;
      default:
        return Spacing.lg;
    }
  };

  const materialStyle = getMaterialStyle();
  const paddingValue = getPadding();

  // reduceTransparency overrides: more opaque, no blur
  const solidBackground = reduceTransparency
    ? isDark
      ? 'rgba(15,20,35,0.92)'
      : 'rgba(255,255,255,0.92)'
    : undefined;

  // Effective blur intensity: 0 when reduceTransparency is on
  const defaultBlur = blurIntensityProp ?? VARIANT_BLUR[variant] ?? 50;
  const effectiveBlur = reduceTransparency ? 0 : defaultBlur;

  // Add filter tint to shadow if filter context is provided
  const shadowStyle: ViewStyle = filterContext
    ? {
        shadowColor: palette.primary,
        shadowOpacity: isDark ? 0.3 : 0.2,
      }
    : {};

  // Ambient glow for dark theme (web only)
  const ambientGlow = glowColor || (filterContext ? palette.glow : undefined);
  const glowStyle: ViewStyle = {};
  if (isDark && Platform.OS === 'web' && ambientGlow && glowIntensity !== 'none') {
    const glowOpacities = { subtle: 0.1, medium: 0.2, strong: 0.3 };
    const glowRadii = { subtle: 40, medium: 60, strong: 80 };
    // @ts-ignore
    glowStyle.boxShadow = `0 0 ${glowRadii[glowIntensity]}px ${ambientGlow}, 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.25)`;
  }

  // Web: keep existing CSS backdrop-filter approach
  if (Platform.OS === 'web') {
    const blurRadius = isDark ? 40 : 24;
    const saturation = isDark ? 200 : 180;
    const webStyles = {
      // @ts-ignore - web-specific property
      backdropFilter: `blur(${blurRadius}px) saturate(${saturation}%)`,
      WebkitBackdropFilter: `blur(${blurRadius}px) saturate(${saturation}%)`,
    };

    return (
      <View
        style={[
          styles.cardContainer,
          materialStyle,
          shadowStyle,
          glowStyle,
          webStyles,
          solidBackground ? { backgroundColor: solidBackground } : undefined,
          { padding: paddingValue },
          style,
        ]}
      >
        {/* Inner highlight for glass effect */}
        <View style={[
          styles.innerHighlight,
          isDark && styles.innerHighlightDark,
        ]} />
        {children}
      </View>
    );
  }

  // Native: BlurView provides the OS-level blur; an rgba overlay sits on top
  // to keep the tinted glass colour. The border/shadow come from materialStyle
  // but backgroundColor is stripped off (BlurView handles the background).
  const { backgroundColor: _bg, ...borderAndShadowStyle } = materialStyle as ViewStyle & { backgroundColor?: string };

  return (
    <BlurView
      intensity={effectiveBlur}
      tint={isDark ? 'dark' : 'light'}
      style={[
        styles.cardContainer,
        borderAndShadowStyle,
        shadowStyle,
        { padding: paddingValue },
        style,
      ]}
    >
      {/* rgba glass overlay — sits below content, on top of blur */}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: solidBackground ?? materialStyle.backgroundColor,
            borderRadius: (materialStyle as ViewStyle).borderRadius as number,
          },
        ]}
      />
      {/* Inner specular highlight */}
      <View style={[
        styles.innerHighlight,
        isDark && styles.innerHighlightDark,
      ]} />
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    overflow: 'hidden',
    position: 'relative',
  },
  innerHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  innerHighlightDark: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
});
