/**
 * GlassButton - Liquid glass styled button
 *
 * Variants:
 * - primary: Glossy teal gradient with glass effect (main CTA like mockup)
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

interface GlassButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'tertiary';
  filterContext?: string;
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

  // Primary button — translucent glass with blur
  if (variant === 'primary') {
    const webGlassStyle = Platform.OS === 'web' ? {
      backdropFilter: 'blur(16px) saturate(180%)',
      WebkitBackdropFilter: 'blur(16px) saturate(180%)',
      boxShadow: '0 0 24px rgba(56,189,248,0.20), inset 0 1px 0 rgba(255,255,255,0.12)',
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
            borderRadius,
            width: fullWidth ? '100%' : undefined,
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
    backgroundColor: 'rgba(56, 189, 248, 0.30)',
    borderWidth: 1.5,
    borderColor: 'rgba(125, 211, 252, 0.40)',
    shadowColor: '#38BDF8',
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
