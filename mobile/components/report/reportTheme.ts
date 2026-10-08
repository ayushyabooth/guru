/**
 * Shared look for Report a bug (GUR-242): the Manrope faces the frames use,
 * the glass tiers with their web blur (the reader's recipe), alpha tints of
 * the theme tokens, and the reduced-motion check for the sheet.
 *
 * Every color comes from the theme tokens (darkTheme / lightTheme); tints are
 * a token at an alpha, never a new hex.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, ViewStyle } from 'react-native';
import {
  GlassMaterialsV2,
  GlassTier,
  getBackdropBlur,
  getDarkBackdropBlur,
  getGlassStyle,
} from '../../constants/liquidGlass';

export { withAlpha } from '../admin/adminTheme';

/** Manrope faces as loaded in app/_layout.tsx, paired with their weight like the Typography tokens. */
export const FACE = {
  regular: { fontFamily: 'Manrope_400Regular', fontWeight: '400' as const },
  medium: { fontFamily: 'Manrope_500Medium', fontWeight: '500' as const },
  semibold: { fontFamily: 'Manrope_600SemiBold', fontWeight: '600' as const },
  bold: { fontFamily: 'Manrope_700Bold', fontWeight: '700' as const },
  extrabold: { fontFamily: 'Manrope_800ExtraBold', fontWeight: '800' as const },
};

/**
 * A glass tier by job (GlassMaterialsV2): ultraThin for chips, thin for pills and
 * quiet buttons, regular for cards, thick for sheets. Adds the tier's blur on web.
 */
export function glassSurface(tier: GlassTier, isDark: boolean): ViewStyle {
  const blur = GlassMaterialsV2[tier].blur;
  return {
    ...getGlassStyle(tier, isDark ? 'dark' : 'light'),
    ...(isDark ? getDarkBackdropBlur(blur) : getBackdropBlur(blur)),
  };
}

/** Local time as "3:42 PM". */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function reducedMotionNow(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

/** True when the OS or browser asks for reduced motion. Animations then show their still frame. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(reducedMotionNow);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduced(!!v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v: boolean) => setReduced(!!v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}
