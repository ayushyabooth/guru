/**
 * Light theme palette — mirror of darkTheme.ts token shape so screens that
 * statically imported `DarkThemeColors.foo` can swap in via a single helper
 * that picks the right object per `ThemeContext.isDark`.
 */
export const LightTheme = {
  // Base Surfaces
  background: '#F8FAFC',
  backgroundSecondary: '#F1F5F9',
  backgroundTertiary: '#E2E8F0',
  overlay: '#FFFFFF',

  // Text
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textTertiary: '#94A3B8',
  textInverse: '#FFFFFF',

  // Glass Materials (light)
  glass: 'rgba(255, 255, 255, 0.85)',
  glassBorder: 'rgba(15, 23, 42, 0.08)',
  glassHighlight: 'rgba(255, 255, 255, 0.9)',
  glassHeavy: 'rgba(255, 255, 255, 0.95)',
  glassLight: 'rgba(255, 255, 255, 0.7)',
  glassSectionBorder: 'rgba(15, 23, 42, 0.06)',

  // Brand (same)
  catchup: '#38BDF8',
  divein: '#EC4899',
  recap: '#FB923C',

  // Accent glows
  catchupGlow: 'rgba(56, 189, 248, 0.12)',
  diveinGlow: 'rgba(236, 72, 153, 0.12)',
  recapGlow: 'rgba(251, 146, 60, 0.12)',

  // Interactive
  interactive: '#6366F1',
  interactiveHover: '#818CF8',
  interactivePressed: '#4F46E5',

  // Semantic
  success: '#059669',
  warning: '#D97706',
  error: '#DC2626',
  info: '#2563EB',

  // Shadows — softer in light mode
  shadowLight: 'rgba(15, 23, 42, 0.05)',
  shadowMedium: 'rgba(15, 23, 42, 0.1)',
  shadowHeavy: 'rgba(15, 23, 42, 0.18)',
};

export default LightTheme;
