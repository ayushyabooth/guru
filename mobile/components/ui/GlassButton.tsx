/**
 * GlassButton - Liquid glass styled button
 *
 * Variants:
 * - primary: Glossy gradient with glass effect (main CTA like mockup)
 * - secondary: Glass background with colored border
 * - tertiary: Text only with subtle background
 */

import React from 'react';
import {
  TouchableOpacity,
  Text,
  View,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  Platform,
} from 'react-native';
import {
  GlassMaterials,
  DarkGlassMaterials,
  BorderRadius,
  Spacing,
  Typography,
  getPalette,
} from '../../constants/liquidGlass';
import DarkThemeColors from '../../constants/darkTheme';
import { useTheme } from '../../contexts/ThemeContext';

/** Convert a hex color (#RGB or #RRGGBB) to rgba string */
function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Lighten a hex color by mixing it toward white */
function lightenHex(hex: string, amount: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
}

interface GlassButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'tertiary';
  filterContext?: string;
  accentColor?: string;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export default function GlassButton({
  title,
  onPress,
  variant = 'primary',
  filterContext,
  accentColor,
  loading = false,
  disabled = false,
  fullWidth = true,
  size = 'md',
  style,
  textStyle,
}: GlassButtonProps) {
  const { isDark, colors } = useTheme();
  const palette = getPalette(filterContext);

  // Size dimensions
  const heights = { sm: 44, md: 52, lg: 60 };
  const height = heights[size];
  const borderRadius = size === 'lg' ? 30 : size === 'md' ? 26 : 22;

  const isDisabled = disabled || loading;

  // Primary button — interactive accent color with glass blur
  if (variant === 'primary') {
    const accent = accentColor || '#6366F1';
    const lightenedAccent = lightenHex(accent, 0.2);

    const webGlassStyle = Platform.OS === 'web' ? {
      backdropFilter: 'blur(16px) saturate(180%)',
      WebkitBackdropFilter: 'blur(16px) saturate(180%)',
      boxShadow: `0 0 24px ${hexToRgba(accent, 0.25)}, inset 0 1px 0 rgba(255,255,255,0.12)`,
    } : {};

    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.85}
        style={[
          styles.primaryContainer,
          {
            height,
            borderRadius: BorderRadius.lg,
            width: fullWidth ? '100%' : undefined,
            backgroundColor: hexToRgba(accent, 0.35),
            borderColor: hexToRgba(lightenedAccent, 0.45),
            shadowColor: accent,
          },
          webGlassStyle as any,
          isDisabled && styles.disabled,
          style,
        ]}
      >
        <View style={styles.content}>
          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text
              style={[
                styles.primaryText,
                size === 'sm' && styles.smallText,
                size === 'lg' && styles.largeText,
                textStyle,
              ]}
            >
              {title}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  // Secondary and tertiary buttons
  const getButtonStyle = (): ViewStyle => {
    const materials = isDark ? DarkGlassMaterials : GlassMaterials;
    const baseStyle: ViewStyle = {
      borderRadius,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      height,
      paddingHorizontal: size === 'sm' ? Spacing.md : Spacing.lg,
      width: fullWidth ? '100%' : undefined,
    };

    if (variant === 'secondary') {
      return {
        ...baseStyle,
        ...materials.button,
        borderColor: palette.primary,
        borderWidth: 1.5,
      };
    }

    // tertiary
    return {
      ...baseStyle,
      backgroundColor: 'transparent',
    };
  };

  const getTextStyle = (): TextStyle => {
    return {
      ...(size === 'sm' ? Typography.labelMedium : Typography.labelLarge),
      fontWeight: '600',
      color: palette.primary,
    };
  };

  return (
    <TouchableOpacity
      style={[getButtonStyle(), isDisabled && styles.disabled, style]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.primary} />
      ) : (
        <Text style={[getTextStyle(), textStyle]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  primaryContainer: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  primaryText: {
    ...Typography.labelLarge,
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  smallText: {
    ...Typography.labelMedium,
  },
  largeText: {
    fontSize: 18,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
});
