/**
 * Dark Matrix Theme
 *
 * Near-black navy base with colored glow accents.
 * Glass effects shine on dark backgrounds — this is the foundation.
 */

export const DarkTheme = {
  // Base Surfaces
  background: '#0A0E17',
  backgroundSecondary: '#111827',
  backgroundTertiary: '#1F2937',
  overlay: '#0F172A',

  // Text
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',
  textInverse: '#0A0E17',

  // Glass Materials
  glass: 'rgba(15, 20, 35, 0.55)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  glassHighlight: 'rgba(255, 255, 255, 0.06)',
  glassHeavy: 'rgba(15, 20, 35, 0.75)',
  glassLight: 'rgba(255, 255, 255, 0.04)',
  glassSectionBorder: 'rgba(255, 255, 255, 0.06)',

  // Brand Colors (Sunset Glass — blue → pink → orange)
  catchup: '#38BDF8',     // Electric sky blue
  divein: '#EC4899',      // Magenta / hot pink
  recap: '#FB923C',       // Coral orange

  // Accent Glows (ambient box-shadows behind glass)
  catchupGlow: 'rgba(56, 189, 248, 0.15)',
  diveinGlow: 'rgba(236, 72, 153, 0.15)',
  recapGlow: 'rgba(251, 146, 60, 0.15)',

  // Semantic colors (slightly brighter for dark bg)
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',

  // Shadows (dark mode shadows are stronger for contrast)
  shadowLight: 'rgba(0, 0, 0, 0.2)',
  shadowMedium: 'rgba(0, 0, 0, 0.4)',
  shadowHeavy: 'rgba(0, 0, 0, 0.6)',
};

export default DarkTheme;
