/**
 * Icon — Semantic vector icon wrapper
 *
 * Thin wrapper around @expo/vector-icons that maps semantic icon names
 * to specific vector icon components. Replaces emojis throughout the app.
 *
 * Usage:
 *   <Icon name="clipboard-text-outline" size={20} color="#38BDF8" />
 *   <Icon name="target" />  // uses theme default color
 */

import React from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../contexts/ThemeContext';
import { StyleProp, TextStyle } from 'react-native';

type IconLibrary = 'mci' | 'mi';

interface IconProps {
  /** Icon name from MaterialCommunityIcons (default) or MaterialIcons */
  name: string;
  /** Icon size in px (default 20) */
  size?: number;
  /** Icon color (defaults to theme textSecondary) */
  color?: string;
  /** Which icon library to use: 'mci' (default) or 'mi' for MaterialIcons */
  library?: IconLibrary;
  /** Additional style */
  style?: StyleProp<TextStyle>;
}

export default function Icon({
  name,
  size = 20,
  color,
  library = 'mci',
  style,
}: IconProps) {
  const { colors } = useTheme();
  const resolvedColor = color || colors.textSecondary;

  if (library === 'mi') {
    return (
      <MaterialIcons
        name={name as any}
        size={size}
        color={resolvedColor}
        style={style}
      />
    );
  }

  return (
    <MaterialCommunityIcons
      name={name as any}
      size={size}
      color={resolvedColor}
      style={style}
    />
  );
}
