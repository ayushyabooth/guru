/**
 * GlassInput - Frosted glass text input with icon support
 *
 * A text input with liquid glass styling matching the design mockup.
 * Features icon prefix, glass border, and focus state animations.
 */

import React, { useState } from 'react';
import {
  TextInput,
  View,
  Text,
  StyleSheet,
  TextInputProps,
  ViewStyle,
  Platform,
} from 'react-native';
import Svg, { Path, G, Circle, Rect } from 'react-native-svg';
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

// Icon components
const UserIcon = ({ size = 20, color = DarkThemeColors.textTertiary }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth={1.5} />
    <Path
      d="M20 21C20 16.5817 16.4183 13 12 13C7.58172 13 4 16.5817 4 21"
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
    />
  </Svg>
);

const LockIcon = ({ size = 20, color = DarkThemeColors.textTertiary }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect
      x="5"
      y="11"
      width="14"
      height="10"
      rx="2"
      stroke={color}
      strokeWidth={1.5}
    />
    <Path
      d="M8 11V7C8 4.79086 9.79086 3 12 3C14.2091 3 16 4.79086 16 7V11"
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
    />
    <Circle cx="12" cy="16" r="1.5" fill={color} />
  </Svg>
);

const KeyIcon = ({ size = 20, color = DarkThemeColors.textTertiary }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="15" cy="9" r="5" stroke={color} strokeWidth={1.5} />
    <Path d="M11 13L4 20M4 20L7 20M4 20L4 17" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const MailIcon = ({ size = 20, color = DarkThemeColors.textTertiary }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect
      x="3"
      y="5"
      width="18"
      height="14"
      rx="2"
      stroke={color}
      strokeWidth={1.5}
    />
    <Path
      d="M3 7L12 13L21 7"
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

interface GlassInputProps extends TextInputProps {
  label?: string;
  error?: string;
  filterContext?: string;
  containerStyle?: ViewStyle;
  icon?: 'user' | 'lock' | 'email' | 'key' | 'none';
}

export default function GlassInput({
  label,
  error,
  filterContext,
  containerStyle,
  style,
  onFocus,
  onBlur,
  icon,
  secureTextEntry,
  keyboardType,
  ...props
}: GlassInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const { isDark, colors } = useTheme();
  const palette = getPalette(filterContext);

  const handleFocus = (e: any) => {
    setIsFocused(true);
    onFocus?.(e);
  };

  const handleBlur = (e: any) => {
    setIsFocused(false);
    onBlur?.(e);
  };

  // Auto-detect icon based on input type if not specified
  const getIcon = () => {
    if (icon === 'none') return null;

    const iconType = icon || (secureTextEntry ? 'lock' : keyboardType === 'email-address' ? 'email' : undefined);
    const iconColor = isFocused ? palette.primary : colors.textTertiary;

    switch (iconType) {
      case 'user':
        return <UserIcon color={iconColor} />;
      case 'lock':
        return <LockIcon color={iconColor} />;
      case 'email':
        return <MailIcon color={iconColor} />;
      case 'key':
        return <KeyIcon color={iconColor} />;
      default:
        return null;
    }
  };

  const iconElement = getIcon();

  const inputMaterial = isDark ? DarkGlassMaterials.input : GlassMaterials.input;

  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>}
      <View
        style={[
          styles.inputWrapper,
          inputMaterial,
          isFocused && styles.inputWrapperFocused,
          isFocused && { borderColor: palette.primary },
          isDark && isFocused && {
            shadowColor: palette.primary,
            shadowOpacity: 0.2,
            shadowRadius: 12,
          },
          error && { borderColor: colors.error, borderWidth: 1.5 },
        ]}
      >
        {iconElement && (
          <View style={styles.iconContainer}>
            {iconElement}
          </View>
        )}
        <TextInput
          style={[
            styles.input,
            { color: colors.textPrimary },
            !iconElement && styles.inputNoIcon,
            style,
          ]}
          placeholderTextColor={colors.textTertiary}
          onFocus={handleFocus}
          onBlur={handleBlur}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          {...props}
        />
      </View>
      {error && error.trim() !== '' && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.md,
  },
  label: {
    ...Typography.labelMedium,
    marginBottom: Spacing.xs,
    marginLeft: Spacing.xs,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: BorderRadius.lg,
  },
  inputWrapperFocused: {
    borderWidth: 2,
    shadowOpacity: 0.08,
  },
  iconContainer: {
    paddingLeft: Spacing.md,
    paddingRight: Spacing.xs,
  },
  input: {
    flex: 1,
    height: 52,
    paddingHorizontal: Spacing.md,
    paddingRight: Spacing.md,
    ...Typography.bodyLarge,
    // For web, override autofill background to stay dark-themed
    ...(Platform.OS === 'web' ? {
      WebkitTextFillColor: '#F1F5F9',
      WebkitBoxShadow: '0 0 0px 1000px #1F2937 inset',
      transition: 'background-color 5000s ease-in-out 0s',
    } : {}),
  },
  inputNoIcon: {
    paddingLeft: Spacing.md,
  },
  errorText: {
    ...Typography.labelSmall,
    marginTop: Spacing.xs,
    marginLeft: Spacing.xs,
  },
});
