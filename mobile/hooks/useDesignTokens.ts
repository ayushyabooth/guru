/**
 * Unified design tokens hook.
 *
 * Returns the correct color palette (Light/Dark), plus shared spacing,
 * border-radius, typography, and glass materials for the current scheme.
 *
 * Usage:
 *   const { colors, spacing, radius, type, glass } = useDesignTokens();
 */

import { useColorScheme } from '@/hooks/use-color-scheme';
import { LightTheme, Spacing, BorderRadius, Typography, GlassMaterials, DarkGlassMaterials } from '@/constants/liquidGlass';
import { DarkTheme } from '@/constants/darkTheme';

export function useDesignTokens() {
  const scheme = useColorScheme() ?? 'dark'; // dark-first app

  const colors = scheme === 'dark' ? DarkTheme : LightTheme;
  const glass = scheme === 'dark' ? DarkGlassMaterials : GlassMaterials;

  return {
    colors,
    spacing: Spacing,
    radius: BorderRadius,
    type: Typography,
    glass,
    isDark: scheme === 'dark',
  } as const;
}
