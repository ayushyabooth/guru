/**
 * ThemeContext — Dual theme provider for the Guru app.
 *
 * Supports dark (default) and light modes with a toggle.
 * Dark mode is optimized for glass effects; light mode uses the LightTheme palette.
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { DarkTheme } from '../constants/darkTheme';
import { LightTheme } from '../constants/liquidGlass';

// Unify the palette shape so consumers can use either interchangeably
type ThemePalette = typeof DarkTheme;

interface ThemeContextValue {
  isDark: boolean;
  colors: ThemePalette;
  toggleTheme: () => void;
}

// Map LightTheme to the same shape as DarkTheme
const lightAsDarkShape: ThemePalette = {
  background: LightTheme.background,
  backgroundSecondary: LightTheme.backgroundSecondary,
  backgroundTertiary: LightTheme.backgroundTertiary,
  overlay: '#E2E8F0',
  textPrimary: LightTheme.textPrimary,
  textSecondary: LightTheme.textSecondary,
  textTertiary: LightTheme.textTertiary,
  textInverse: LightTheme.textInverse,
  glass: LightTheme.glassBackground,
  glassBorder: LightTheme.glassBorder,
  glassHighlight: LightTheme.glassHighlight,
  glassHeavy: 'rgba(255,255,255,0.65)',
  glassLight: 'rgba(255,255,255,0.4)',
  glassSectionBorder: 'rgba(0,0,0,0.06)',
  catchup: '#38BDF8',
  divein: '#EC4899',
  recap: '#FB923C',
  catchupGlow: 'rgba(56, 189, 248, 0.1)',
  diveinGlow: 'rgba(236, 72, 153, 0.1)',
  recapGlow: 'rgba(251, 146, 60, 0.1)',
  interactive: LightTheme.interactive,
  interactiveHover: LightTheme.interactiveHover,
  interactivePressed: LightTheme.interactivePressed,
  success: LightTheme.success,
  warning: LightTheme.warning,
  error: LightTheme.error,
  info: LightTheme.info,
  shadowLight: LightTheme.shadowLight,
  shadowMedium: LightTheme.shadowMedium,
  shadowHeavy: LightTheme.shadowHeavy,
};

const ThemeContext = createContext<ThemeContextValue>({
  isDark: true,
  colors: DarkTheme,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(true);

  const toggleTheme = useCallback(() => {
    setIsDark(prev => !prev);
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    isDark,
    colors: isDark ? DarkTheme : lightAsDarkShape,
    toggleTheme,
  }), [isDark, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export default ThemeContext;
