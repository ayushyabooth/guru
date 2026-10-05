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
import Icon from './Icon';

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
  /** Override the screen-reader label — defaults to `title`. */
  accessibilityLabel?: string;
  /** Optional supplemental hint for screen readers. */
  accessibilityHint?: string;
  /** Phosphor/MCI icon name to render left of the label */
  icon?: string;
  /** Icon size in px — defaults to 16 per GUR-147 spec */
  iconSize?: number;
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
  accessibilityLabel,
  accessibilityHint,
  icon,
  iconSize = 16,
}: GlassButtonProps) {
  const { isDark, colors } = useTheme();
  const palette = getPalette(filterContext);

  // Size dimensions
  const heights = { sm: 44, md: 52, lg: 60 };
  const height = heights[size];
  const borderRadius = size === 'lg' ? 30 : size === 'md' ? 26 : 22;

  const isDisabled = disabled || loading;

  // Primary button — translucent glass with 18% context-color fill per GUR-147 spec
  if (variant === 'primary') {
    const accent = accentColor || '#6366F1';
    const lightenedAccent = lightenHex(accent, 0.25);
    // GUR-147: 18% fill in dark, 22% in light (still translucent but visible on light bg)
    const fillOpacity = isDark ? 0.18 : 0.22;
    // Glow: 22% accent opacity shadow
    const glowOpacity = isDark ? 0.22 : 0.28;

    const webGlassStyle = Platform.OS === 'web' ? {
      backdropFilter: 'blur(24px) saturate(200%)',
      WebkitBackdropFilter: 'blur(24px) saturate(200%)',
      boxShadow: isDark
        ? `0 0 32px ${hexToRgba(accent, glowOpacity)}, inset 0 1px 0 rgba(255,255,255,0.18)`
        : `0 4px 20px ${hexToRgba(accent, glowOpacity)}, inset 0 1px 0 rgba(255,255,255,0.30)`,
    } : {};

    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || title}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        style={[
          styles.primaryContainer,
          {
            height,
            borderRadius: BorderRadius.lg,
            width: fullWidth ? '100%' : undefined,
            backgroundColor: hexToRgba(accent, fillOpacity),
            borderColor: isDark
              ? hexToRgba(lightenedAccent, 0.45)
              : hexToRgba(accent, 0.40),
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
            <View style={styles.labelRow}>
              {icon && (
                <Icon
                  name={icon}
                  size={iconSize}
                  color="#FFFFFF"
                  weight="bold"
                  style={styles.iconLeft}
                />
              )}
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
            </View>
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
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.primary} />
      ) : (
        <View style={styles.labelRow}>
          {icon && (
            <Icon
              name={icon}
              size={iconSize}
              color={palette.primary}
              weight="regular"
              style={styles.iconLeft}
            />
          )}
          <Text style={[getTextStyle(), textStyle]}>{title}</Text>
        </View>
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  iconLeft: {
    // slight shift up to optically align icon with cap-height of text
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
