/**
 * Runtime theme-aware palette accessor. Returns the right token object
 * (DarkTheme vs LightTheme) based on the current ThemeContext value.
 *
 * Existing screens importing `DarkThemeColors.foo` statically can migrate by
 * swapping to `useThemeColors().foo` — no other structural change needed.
 */
import { useTheme } from '../contexts/ThemeContext';
import DarkTheme from './darkTheme';
import LightTheme from './lightTheme';

export function useThemeColors() {
  const { isDark } = useTheme();
  return isDark ? DarkTheme : LightTheme;
}
