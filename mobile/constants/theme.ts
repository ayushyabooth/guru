/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

/**
 * Filter/Category Colors - Now delegated to the central industryConfig.ts
 *
 * To add a new industry/specialization/interest, edit constants/industryConfig.ts.
 * Everything below re-exports from that single source.
 */
export {
  getFilterColors,
  getIndustryConfig,
  getIndustryAccent,
  getIndustryIcon,
  getAllIndustries,
  getIndustriesByCategory,
  getFilterPalette,
  AnnotationTypeConfig,
} from './industryConfig';
export type { FilterColorConfig, ResolvedVisualConfig, FilterPalette } from './industryConfig';

/**
 * Annotation type colors for Reader Mode
 * Kept in original shape for backward compat. Phase 3 will migrate to AnnotationTypeConfig.
 */
export const AnnotationColors = {
  reflection: { bg: 'rgba(16,185,129,0.1)', accent: '#10B981', icon: 'thought-bubble-outline' },
  expert_insight: { bg: 'rgba(245,158,11,0.1)', accent: '#F59E0B', icon: 'lightbulb-outline' },
  leading_question: { bg: 'rgba(56,189,248,0.1)', accent: '#38BDF8', icon: 'help-circle-outline' },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
