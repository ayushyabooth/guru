/**
 * GURU Liquid Glass Design System
 *
 * Inspired by Apple visionOS and modern glassmorphism principles.
 * This design system provides:
 * - Dynamic color palettes for each industry filter
 * - Liquid glass material effects (backdrop blur, gradients, shadows)
 * - Organic shape styling
 * - Typography and spacing tokens
 */

import { Platform, StyleSheet, ViewStyle, TextStyle } from 'react-native';

// ============================================================================
// DYNAMIC COLOR SYSTEM
// Colors change based on the user's selected industry filter
// ============================================================================

// ============================================================================
// FILTER PALETTES — delegated to central industryConfig.ts
// To add a new industry/specialization, edit constants/industryConfig.ts.
// ============================================================================

export { getFilterPalette as getPalette } from './industryConfig';
export type { FilterPalette } from './industryConfig';
import { getFilterPalette } from './industryConfig';

// Local alias for internal use within this file
const getPalette = getFilterPalette;

// Backward-compatible default
export const DefaultPalette = getFilterPalette('consumer');

// ============================================================================
// THREE RINGS COLORS
// The iconic three interlocking rings representing the three learning modes
// ============================================================================

export const RingColors = {
  catchup: {
    primary: '#38BDF8',    // Electric sky blue
    light: '#7DD3FC',
    dark: '#0284C7',
    gradient: ['#7DD3FC', '#38BDF8', '#0284C7'],
  },
  divein: {
    primary: '#EC4899',    // Magenta / hot pink
    light: '#F472B6',
    dark: '#DB2777',
    gradient: ['#F472B6', '#EC4899', '#DB2777'],
  },
  recap: {
    primary: '#FB923C',    // Coral orange
    light: '#FDBA74',
    dark: '#EA580C',
    gradient: ['#FDBA74', '#FB923C', '#EA580C'],
  },
};

// ============================================================================
// LIGHT THEME COLORS
// Primary color scheme for the liquid glass aesthetic
// ============================================================================

export const LightTheme = {
  // Backgrounds
  background: '#F8FAFC',           // Main app background
  backgroundSecondary: '#F1F5F9',  // Secondary/card background
  backgroundTertiary: '#E2E8F0',   // Tertiary surfaces

  // Glass surfaces
  glassBackground: 'rgba(255,255,255,0.85)',
  glassBorder: 'rgba(255,255,255,0.6)',
  glassHighlight: 'rgba(255,255,255,0.9)',

  // Text
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textTertiary: '#94A3B8',
  textInverse: '#FFFFFF',

  // Interactive (CTAs, links, accents)
  interactive: '#6366F1',       // Indigo 500
  interactiveHover: '#818CF8',  // Indigo 400
  interactivePressed: '#4F46E5', // Indigo 600

  // Semantic colors
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',

  // Shadows
  shadowLight: 'rgba(0,0,0,0.04)',
  shadowMedium: 'rgba(0,0,0,0.08)',
  shadowHeavy: 'rgba(0,0,0,0.12)',
};

// ============================================================================
// SPACING & SIZING TOKENS
// ============================================================================

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const BorderRadius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  pill: 999,
};

// ============================================================================
// TYPOGRAPHY
// ============================================================================

// Manrope — peppy + sleek primary font for all reading + UI.
// Orbitron reserved for the GURU wordmark logo only (loaded in _layout.tsx).
// Font-family strings match @expo-google-fonts/manrope's exports.
const FAM = {
  bold: 'Manrope_800ExtraBold',
  semibold: 'Manrope_700Bold',
  medium: 'Manrope_600SemiBold',
  regular: 'Manrope_500Medium',
  body: 'Manrope_400Regular',
};

export const Typography = {
  // Display
  displayLarge: {
    fontFamily: FAM.bold,
    fontSize: 40,
    fontWeight: '800' as const,
    lineHeight: 48,
    letterSpacing: -0.8,
  },
  displayMedium: {
    fontFamily: FAM.bold,
    fontSize: 32,
    fontWeight: '800' as const,
    lineHeight: 40,
    letterSpacing: -0.6,
  },
  displaySmall: {
    fontFamily: FAM.semibold,
    fontSize: 28,
    fontWeight: '700' as const,
    lineHeight: 36,
    letterSpacing: -0.4,
  },

  // Headlines
  headlineLarge: {
    fontFamily: FAM.semibold,
    fontSize: 24,
    fontWeight: '700' as const,
    lineHeight: 32,
    letterSpacing: -0.3,
  },
  headlineMedium: {
    fontFamily: FAM.semibold,
    fontSize: 20,
    fontWeight: '700' as const,
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  headlineSmall: {
    fontFamily: FAM.medium,
    fontSize: 18,
    fontWeight: '600' as const,
    lineHeight: 24,
    letterSpacing: -0.1,
  },

  // Body
  bodyLarge: {
    fontFamily: FAM.body,
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 25,
    letterSpacing: 0,
  },
  bodyMedium: {
    fontFamily: FAM.body,
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 22,
    letterSpacing: 0,
  },
  bodySmall: {
    fontFamily: FAM.body,
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 18,
    letterSpacing: 0.1,
  },

  // Labels
  labelLarge: {
    fontFamily: FAM.medium,
    fontSize: 14,
    fontWeight: '600' as const,
    lineHeight: 20,
    letterSpacing: 0.2,
  },
  labelMedium: {
    fontFamily: FAM.medium,
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 16,
    letterSpacing: 0.4,
  },
  labelSmall: {
    fontFamily: FAM.medium,
    fontSize: 11,
    fontWeight: '600' as const,
    lineHeight: 14,
    letterSpacing: 0.5,
  },
};

/**
 * Primary font stack string for `fontFamily` when you need a stringy value.
 * Falls back to system sans-serif if Manrope fails to load.
 */
export const FontStack = {
  primary: 'Manrope_400Regular, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  primaryBold: 'Manrope_700Bold, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  display: 'Orbitron_700Bold, "Manrope_800ExtraBold", -apple-system, sans-serif',
};

// ============================================================================
// LIQUID GLASS MATERIAL STYLES
// Core styles for the frosted glass effect
// ============================================================================

export const GlassMaterials = {
  // Standard glass card
  card: {
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.07)',
    borderRadius: BorderRadius.xl,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 6,
  } as ViewStyle,

  // Heavy frosted glass (for prominent cards like login form)
  cardHeavy: {
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.08)',
    borderRadius: BorderRadius.xl,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 8,
  } as ViewStyle,

  // Light glass (very subtle, for nested surfaces within cards)
  cardLight: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.05)',
    borderRadius: BorderRadius.lg,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 3,
  } as ViewStyle,

  // Glass button
  button: {
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.07)',
    borderRadius: BorderRadius.lg,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  } as ViewStyle,

  // Glass input field
  input: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.08)',
    borderRadius: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  } as ViewStyle,

  // Glass pill (for tags, chips)
  pill: {
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    borderRadius: BorderRadius.pill,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  } as ViewStyle,

  // Navigation / breadcrumb bar
  navBar: {
    backgroundColor: 'rgba(248,250,252,0.88)',
    borderWidth: 0,
    borderBottomWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4,
  } as ViewStyle,

  // Tab bar glass
  tabBar: {
    backgroundColor: 'rgba(248,250,252,0.90)',
    borderTopWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 8,
  } as ViewStyle,
};

// ============================================================================
// DARK GLASS MATERIALS
// Glass effects for dark Matrix theme — glass shines on dark backgrounds
// ============================================================================

export const DarkGlassMaterials = {
  // Standard dark glass card
  card: {
    backgroundColor: 'rgba(15, 20, 35, 0.42)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: BorderRadius.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 32,
    elevation: 8,
  } as ViewStyle,

  // Heavy dark glass (modals, Guru messages)
  cardHeavy: {
    backgroundColor: 'rgba(15, 20, 35, 0.65)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: BorderRadius.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 40,
    elevation: 10,
  } as ViewStyle,

  // Light section surface (within cards — Spotlight, Why It Matters, etc.)
  cardLight: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: BorderRadius.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 2,
  } as ViewStyle,

  // Dark glass button
  button: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: BorderRadius.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  } as ViewStyle,

  // Dark glass input
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: BorderRadius.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 2,
  } as ViewStyle,

  // Dark glass pill (tags, chips, badges)
  pill: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: BorderRadius.pill,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 2,
  } as ViewStyle,

  // Navigation / breadcrumb bar
  navBar: {
    backgroundColor: 'rgba(15, 20, 35, 0.75)',
    borderWidth: 0,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  } as ViewStyle,

  // Tab bar glass
  tabBar: {
    backgroundColor: 'rgba(15, 20, 35, 0.85)',
    borderTopWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  } as ViewStyle,
};

// Get dark backdrop blur style
export const getDarkBackdropBlur = (radius: number = 40): ViewStyle => {
  if (Platform.OS === 'web') {
    return {
      // @ts-ignore - web-specific property
      backdropFilter: `blur(${radius}px) saturate(200%)`,
      WebkitBackdropFilter: `blur(${radius}px) saturate(200%)`,
    } as ViewStyle;
  }
  return {};
};

// Get glass card with ambient glow (for dark theme)
export const getDarkGlassCardStyle = (glowColor?: string, intensity: 'none' | 'subtle' | 'medium' | 'strong' = 'subtle'): ViewStyle => {
  const glowOpacities = { none: 0, subtle: 0.1, medium: 0.2, strong: 0.3 };
  const glowRadii = { none: 0, subtle: 40, medium: 60, strong: 80 };

  const baseStyle: ViewStyle = {
    ...DarkGlassMaterials.card,
  };

  if (Platform.OS === 'web' && glowColor && intensity !== 'none') {
    return {
      ...baseStyle,
      // @ts-ignore
      boxShadow: `0 0 ${glowRadii[intensity]}px ${glowColor.replace(/[\d.]+\)$/, `${glowOpacities[intensity]})`).replace('rgb', 'rgba')}, 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)`,
    };
  }

  return baseStyle;
};

// ============================================================================
// MATERIALS HIERARCHY (EDL v2 — 5 tiers)
// Source of truth: Figma `Glass / Materials Hierarchy` (77:3)
// Each tier provides blur, opacity, border, shadow recipe for dark + light.
// ============================================================================

export type GlassTier = 'ultraThin' | 'thin' | 'regular' | 'thick' | 'chrome';

export interface GlassTierSpec {
  blur: number;
  opacityDark: number;   // fill opacity on dark bg (white at this opacity)
  opacityLight: number;  // fill opacity on light bg (white at this opacity)
  borderOpacityDark: number;
  borderOpacityLight: number;
  innerHighlightDark: number;
  innerHighlightLight: number;
  shadowY: number;
  shadowBlur: number;
  shadowOpacityDark: number;
  shadowOpacityLight: number;
}

export const GlassMaterialsV2: Record<GlassTier, GlassTierSpec> = {
  ultraThin: {
    blur: 12,
    opacityDark: 0.14,
    opacityLight: 0.55,
    borderOpacityDark: 0.12,
    borderOpacityLight: 0.45,
    innerHighlightDark: 0.20,
    innerHighlightLight: 0.30,
    shadowY: 4,
    shadowBlur: 16,
    shadowOpacityDark: 0.20,
    shadowOpacityLight: 0.05,
  },
  thin: {
    blur: 16,
    opacityDark: 0.18,
    opacityLight: 0.70,
    borderOpacityDark: 0.15,
    borderOpacityLight: 0.50,
    innerHighlightDark: 0.25,
    innerHighlightLight: 0.35,
    shadowY: 6,
    shadowBlur: 24,
    shadowOpacityDark: 0.30,
    shadowOpacityLight: 0.08,
  },
  regular: {
    blur: 24,
    opacityDark: 0.22,
    opacityLight: 0.82,
    borderOpacityDark: 0.18,
    borderOpacityLight: 0.55,
    innerHighlightDark: 0.30,
    innerHighlightLight: 0.40,
    shadowY: 12,
    shadowBlur: 32,
    shadowOpacityDark: 0.40,
    shadowOpacityLight: 0.10,
  },
  thick: {
    blur: 40,
    opacityDark: 0.32,
    opacityLight: 0.90,
    borderOpacityDark: 0.22,
    borderOpacityLight: 0.65,
    innerHighlightDark: 0.35,
    innerHighlightLight: 0.45,
    shadowY: 16,
    shadowBlur: 48,
    shadowOpacityDark: 0.50,
    shadowOpacityLight: 0.14,
  },
  chrome: {
    blur: 56,
    opacityDark: 0.40,
    opacityLight: 0.94,
    borderOpacityDark: 0.28,
    borderOpacityLight: 0.70,
    innerHighlightDark: 0.40,
    innerHighlightLight: 0.50,
    shadowY: 20,
    shadowBlur: 56,
    shadowOpacityDark: 0.55,
    shadowOpacityLight: 0.18,
  },
};

/**
 * Produce a ViewStyle block for a given tier + mode.
 * Pass tint color hex to add a subtle colored glow shadow (filter context).
 */
export const getGlassStyle = (
  tier: GlassTier,
  mode: 'dark' | 'light',
  tint?: string
): ViewStyle => {
  const t = GlassMaterialsV2[tier];
  const fill = mode === 'dark' ? t.opacityDark : t.opacityLight;
  const border = mode === 'dark' ? t.borderOpacityDark : t.borderOpacityLight;
  const shadowOp = mode === 'dark' ? t.shadowOpacityDark : t.shadowOpacityLight;
  // Dark mode uses a DARK navy-translucent fill (not white) so glass surfaces
  // blend with the dark UI as true liquid glass instead of reading as bright
  // gray bands (GUR-218 follow-up / reader polish). opacityDark (0.14–0.40)
  // maps to a dark fill of ~0.54–0.80 — subtle tiers stay see-through, chrome
  // bars get dense enough for text legibility. Light mode keeps white glass.
  const base: ViewStyle = {
    backgroundColor: mode === 'dark'
      ? `rgba(13,17,28,${Math.min(0.85, 0.4 + fill)})`
      : `rgba(255,255,255,${fill})`,
    borderWidth: 1.5,
    borderColor: `rgba(255,255,255,${border})`,
    borderRadius: BorderRadius.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: t.shadowY },
    shadowOpacity: shadowOp,
    shadowRadius: t.shadowBlur,
    elevation: Math.ceil(t.shadowBlur / 4),
  };
  return base;
};

// ============================================================================
// FILTER PILL GLASS TOKENS (GUR-132)
// Source of truth: Figma "Glass Pills v3 — True Translucency" (node 95:2)
// ============================================================================

export const FilterPillTokens = {
  // Glass blob (active indicator)
  blobFillOpacity: 0.18,       // L1: glass surface fill opacity
  blobBlurRadius: 28,          // backdrop-blur radius (px)
  blobTintOpacity: 0.10,       // L2: accent color tint opacity
  blobCombinedOpacity: 0.28,   // effective combined opacity through glass
  blobBorderOpacityDark: 0.28, // L5: bright border (dark mode)
  blobBorderOpacityLight: 0.40,// L5: accent border (light mode)
  blobStretchFactor: 1.15,     // width multiplier mid-flight

  // Spring spec
  springMass: 1,
  springStiffness: 280,
  springDamping: 24,

  // Timing
  transitionDuration: 350,     // total morph duration (ms)
  textFadeOutDuration: 60,     // active text out (ms)
  textFadeInDelay: 200,        // active text in delay (ms)
  textFadeInDuration: 90,      // active text in duration (ms)

  // Proximity glow ripple
  glowTriggerDistance: 40,     // px — when blob center is within this of a pill center
  glowBorderOpacity: 0.15,     // pulse border glow intensity
  glowDecayDuration: 150,      // ease-out after blob passes (ms)
};

// ============================================================================
// ANIMATION TIMING
// Consistent animation curves and durations
// ============================================================================

export const Animation = {
  // Durations
  fast: 150,
  normal: 250,
  slow: 400,
  verySlow: 600,

  // Easing (for use with Animated or Reanimated)
  easing: {
    // Smooth deceleration
    standard: [0.4, 0, 0.2, 1] as const,
    // Quick start
    accelerate: [0.4, 0, 1, 1] as const,
    // Smooth end
    decelerate: [0, 0, 0.2, 1] as const,
    // Bouncy
    bounce: [0.68, -0.55, 0.265, 1.55] as const,
  },
};

// ============================================================================
// ORGANIC BACKGROUND BLOB POSITIONS
// Pre-defined positions for decorative background blobs
// ============================================================================

export const BlobPositions = {
  topLeft: { top: -100, left: -80 },
  topRight: { top: -60, right: -100 },
  bottomLeft: { bottom: -80, left: -60 },
  bottomRight: { bottom: -100, right: -80 },
  centerLeft: { top: '40%', left: -120 },
  centerRight: { top: '35%', right: -100 },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get glass card style with dynamic filter tint
 */
export const getGlassCardStyle = (filterKey?: string): ViewStyle => {
  const palette = getPalette(filterKey);
  return {
    ...GlassMaterials.card,
    // Add subtle tint based on filter
    backgroundColor: `rgba(255,255,255,0.82)`,
    shadowColor: palette.primary,
    shadowOpacity: 0.15,
  };
};

/**
 * Get primary button style with filter color
 */
export const getPrimaryButtonStyle = (filterKey?: string): ViewStyle => {
  const palette = getPalette(filterKey);
  return {
    backgroundColor: palette.primary,
    borderRadius: BorderRadius.lg,
    shadowColor: palette.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  };
};

/**
 * Create backdrop blur style (for web/platforms that support it)
 */
export const getBackdropBlur = (radius: number = 24): ViewStyle => {
  if (Platform.OS === 'web') {
    return {
      // @ts-ignore - web-specific property
      backdropFilter: `blur(${radius}px) saturate(180%)`,
      WebkitBackdropFilter: `blur(${radius}px) saturate(180%)`,
    } as ViewStyle;
  }
  // On native, we rely on backgroundColor opacity instead
  return {};
};

// ============================================================================
// COMMON STYLE PRESETS
// ============================================================================

export const CommonStyles = StyleSheet.create({
  // Screen container with light background
  screenContainer: {
    flex: 1,
    backgroundColor: LightTheme.background,
  },

  // Centered content wrapper
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },

  // Glass card wrapper
  glassCard: {
    ...GlassMaterials.card,
    padding: Spacing.lg,
  },

  // Primary text
  textPrimary: {
    color: LightTheme.textPrimary,
    ...Typography.bodyLarge,
  },

  // Secondary text
  textSecondary: {
    color: LightTheme.textSecondary,
    ...Typography.bodyMedium,
  },

  // Title text
  title: {
    color: LightTheme.textPrimary,
    ...Typography.headlineLarge,
  },

  // Subtitle text
  subtitle: {
    color: LightTheme.textSecondary,
    ...Typography.bodyLarge,
  },
});

export default {
  DefaultPalette,
  getPalette,
  RingColors,
  LightTheme,
  Spacing,
  BorderRadius,
  Typography,
  GlassMaterials,
  FilterPillTokens,
  Animation,
  BlobPositions,
  getGlassCardStyle,
  getPrimaryButtonStyle,
  getBackdropBlur,
  CommonStyles,
};
