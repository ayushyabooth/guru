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
 * Note: On web, uses CSS backdrop-filter. On native, uses semi-transparent background.
 */

import React from 'react';
import {
  View,
  StyleSheet,
  ViewStyle,
  Platform,
} from 'react-native';
import {
  GlassMaterials,
  DarkGlassMaterials,
  getPalette,
  Spacing,
} from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';

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

export default function GlassCard({
  children,
  style,
  variant = 'standard',
  filterContext,
  padding = 'lg',
  glowColor,
  glowIntensity = 'none',
}: GlassCardProps) {
  const { isDark } = useTheme();
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
    glowStyle.boxShadow = `0 0 ${glowRadii[glowIntensity]}px ${ambientGlow}, 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)`;
  }

  // Web-specific styles with backdrop-filter
  const blurRadius = isDark ? 40 : 24;
  const saturation = isDark ? 200 : 180;
  const webStyles = Platform.OS === 'web'
    ? {
        // @ts-ignore - web-specific property
        backdropFilter: `blur(${blurRadius}px) saturate(${saturation}%)`,
        WebkitBackdropFilter: `blur(${blurRadius}px) saturate(${saturation}%)`,
      }
    : {};

  return (
    <View
      style={[
        styles.cardContainer,
        materialStyle,
        shadowStyle,
        glowStyle,
        webStyles,
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
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
});
