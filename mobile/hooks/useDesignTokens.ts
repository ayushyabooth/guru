/**
 * Unified design tokens hook.
 *
 * Returns the correct color palette (Light/Dark), plus shared spacing,
 * border-radius, typography, and glass materials for the current scheme.
 *
 * Usage:
 *   const { colors, spacing, radius, type, glass } = useDesignTokens();
 */

import { LightTheme, Spacing, BorderRadius, Typography, GlassMaterials, DarkGlassMaterials } from '@/constants/liquidGlass';
import { DarkTheme } from '@/constants/darkTheme';
import { useTheme } from '@/contexts/ThemeContext';

export function useDesignTokens() {
  const { isDark } = useTheme();

  const colors = isDark ? DarkTheme : LightTheme;
  const glass = isDark ? DarkGlassMaterials : GlassMaterials;

  return {
    colors,
    spacing: Spacing,
    radius: BorderRadius,
    type: Typography,
    glass,
    isDark,
  } as const;
}
