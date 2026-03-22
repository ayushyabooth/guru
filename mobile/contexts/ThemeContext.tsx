/**
 * ThemeContext — Dark-only theme provider for the Guru app.
 *
 * Dark mode is the ONLY mode — glass effects need dark backgrounds to shine.
 * Provides the full palette object + isDark flag to all consumers.
 */

import React, { createContext, useContext } from 'react';
import { DarkTheme } from '../constants/darkTheme';

type ThemePalette = typeof DarkTheme;

interface ThemeContextValue {
  isDark: boolean;
  colors: ThemePalette;
  toggleTheme: () => void;
}

const darkValue: ThemeContextValue = {
  isDark: true,
  colors: DarkTheme,
  toggleTheme: () => {},  // no-op — dark is the only mode
};

const ThemeContext = createContext<ThemeContextValue>(darkValue);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeContext.Provider value={darkValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export default ThemeContext;
