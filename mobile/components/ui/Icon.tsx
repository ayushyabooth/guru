/**
 * Icon — Phosphor Icon wrapper
 *
 * Maps legacy MaterialCommunityIcons names to Phosphor React Native icons.
 * Provides a consistent API: <Icon name="target" size={20} color="#38BDF8" weight="duotone" />
 *
 * Weight guide:
 *   - "regular" (default): Most UI icons
 *   - "bold": Active states, primary CTAs
 *   - "duotone": Section headers, category icons (20% fill + stroke)
 *   - "fill": Toggled/saved states
 *   - "light": Secondary/tertiary UI
 *   - "thin": Decorative, large display
 */

import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { StyleProp, ViewStyle } from 'react-native';

// Import Phosphor icons individually for tree-shaking
import { ClipboardText } from 'phosphor-react-native';
import { Quotes } from 'phosphor-react-native';
import { Target } from 'phosphor-react-native';
import { MagnifyingGlass } from 'phosphor-react-native';
import { Lightbulb } from 'phosphor-react-native';
import { BookOpenText } from 'phosphor-react-native';
import { BookmarkSimple } from 'phosphor-react-native';
import { X } from 'phosphor-react-native';
import { ShareNetwork } from 'phosphor-react-native';
import { CheckCircle } from 'phosphor-react-native';
import { Check } from 'phosphor-react-native';
import { ArrowSquareOut } from 'phosphor-react-native';
import { Play } from 'phosphor-react-native';
import { CaretRight } from 'phosphor-react-native';
import { CaretLeft } from 'phosphor-react-native';
import { PaperPlaneRight } from 'phosphor-react-native';
import { Headphones } from 'phosphor-react-native';
import { Sparkle } from 'phosphor-react-native';
import { LockOpen } from 'phosphor-react-native';
import { Lock } from 'phosphor-react-native';
import { Envelope } from 'phosphor-react-native';
import { Key } from 'phosphor-react-native';
import { Warning } from 'phosphor-react-native';
import { WarningCircle } from 'phosphor-react-native';
import { Info } from 'phosphor-react-native';
import { ShoppingBag } from 'phosphor-react-native';
import { Laptop } from 'phosphor-react-native';
import { ChartLineUp } from 'phosphor-react-native';
import { FirstAid } from 'phosphor-react-native';
import { Lightning } from 'phosphor-react-native';
import { ForkKnife } from 'phosphor-react-native';
import { Storefront } from 'phosphor-react-native';
import { Newspaper } from 'phosphor-react-native';
import { Car } from 'phosphor-react-native';
import { Star } from 'phosphor-react-native';
import { StarFour } from 'phosphor-react-native';
import { ArrowLeft } from 'phosphor-react-native';
import { Circle } from 'phosphor-react-native';
import { ChatCircleDots } from 'phosphor-react-native';
import { ChatTeardropDots } from 'phosphor-react-native';
import { NoteBlank } from 'phosphor-react-native';
import { NotePencil } from 'phosphor-react-native';
import { PencilSimple } from 'phosphor-react-native';
import { Marker } from 'phosphor-react-native';
import { Crosshair } from 'phosphor-react-native';
import { FileDoc } from 'phosphor-react-native';
import { Books } from 'phosphor-react-native';
import { Tag } from 'phosphor-react-native';
import { Compass } from 'phosphor-react-native';
import { ThumbsUp } from 'phosphor-react-native';
import { Barbell } from 'phosphor-react-native';
import { MagicWand } from 'phosphor-react-native';
import { PaperPlaneTilt } from 'phosphor-react-native';
import { Sneaker } from 'phosphor-react-native';
import { House } from 'phosphor-react-native';
import { ShoppingCart } from 'phosphor-react-native';
import { Briefcase } from 'phosphor-react-native';
import { DeviceMobile } from 'phosphor-react-native';
import { Cpu } from 'phosphor-react-native';
import { FlowerLotus } from 'phosphor-react-native';
import { Broadcast } from 'phosphor-react-native';
import { CalendarBlank } from 'phosphor-react-native';
import { Feather } from 'phosphor-react-native';
import { Scales } from 'phosphor-react-native';
import { Fire } from 'phosphor-react-native';

// Weight type from Phosphor
type IconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';

// Map legacy MCI/MI names to Phosphor components
const ICON_MAP: Record<string, React.ComponentType<any>> = {
  // Section headers (use duotone weight)
  'clipboard-text-outline': ClipboardText,
  'format-quote-open': Quotes,
  'target': Target,
  'magnify': MagnifyingGlass,
  'lightbulb-outline': Lightbulb,

  // CTA icons
  'book-open-variant': BookOpenText,
  'bookmark-outline': BookmarkSimple,
  'bookmark': BookmarkSimple,       // fill weight applied via weight prop
  'bookmark-check': BookmarkSimple,  // fill weight
  'close': X,
  'share': ShareNetwork,
  'check': Check,
  'check-circle': CheckCircle,
  'send': PaperPlaneTilt,

  // Navigation
  'arrow-left': ArrowLeft,
  'chevron-right': CaretRight,
  'chevron-left': CaretLeft,
  'chevron-up': CaretRight,    // rotated via style
  'chevron-down': CaretRight,  // rotated via style

  // Media / Actions
  'headphones': Headphones,
  'play': Play,
  'star': Star,
  'star-four-points': StarFour,
  'sparkle': Sparkle,
  'lock': Lock,
  'lock-outline': Lock,
  'lock-open': LockOpen,

  // Auth inputs
  'email': Envelope,
  'key': Key,

  // Status
  'alert-outline': Warning,
  'alert-circle-outline': WarningCircle,
  'info': Info,

  // Industry icons
  'shopping-outline': ShoppingBag,
  'shopping-bag': ShoppingBag,
  'cart-outline': ShoppingCart,
  'chart-line': ChartLineUp,
  'monitor': Laptop,
  'laptop': Laptop,
  'medical-bag': FirstAid,
  'hospital-box-outline': FirstAid,
  'lightning-bolt': Lightning,
  'flash-outline': Lightning,
  'food-apple-outline': ForkKnife,
  'food-apple': ForkKnife,
  'silverware-fork-knife': ForkKnife,
  'store-outline': Storefront,
  'newspaper': Newspaper,
  'car': Car,
  'sneaker': Sneaker,
  'shoe-sneaker': Sneaker,
  'home-outline': House,
  'briefcase-outline': Briefcase,
  'cellphone': DeviceMobile,
  'chip': Cpu,
  'spa-outline': FlowerLotus,
  'broadcast': Broadcast,

  // Content
  'circle': Circle,
  'circle-small': Circle,
  'file-document-outline': FileDoc,
  'note-edit-outline': NotePencil,
  'note-text-outline': NoteBlank,
  'chat-question-outline': ChatCircleDots,
  'message-text-outline': ChatTeardropDots,
  'thought-bubble-outline': ChatCircleDots,
  'marker': Marker,
  'crosshairs-gps': Crosshair,
  'bookshelf': Books,
  'tag-outline': Tag,
  'compass-outline': Compass,
  'arm-flex-outline': Barbell,
  'auto-fix': MagicWand,

  // Recap stage icons
  'calendar': CalendarBlank,
  'feather': Feather,
  'scales': Scales,
  'fire': Fire,
};

// Names that should default to 'fill' weight
const FILL_NAMES = new Set(['bookmark', 'bookmark-check']);

// Names that should default to 'duotone' weight for section headers
const DUOTONE_NAMES = new Set([
  'clipboard-text-outline', 'format-quote-open', 'target', 'magnify', 'lightbulb-outline',
]);

interface IconProps {
  /** Icon name — supports legacy MCI names or Phosphor semantic names */
  name: string;
  /** Icon size in px (default 20) */
  size?: number;
  /** Icon color (defaults to theme textSecondary) */
  color?: string;
  /** Phosphor weight: thin | light | regular | bold | fill | duotone */
  weight?: IconWeight;
  /** @deprecated Use weight instead. Kept for backward compat. */
  library?: string;
  /** Additional style */
  style?: StyleProp<ViewStyle>;
}

export default function Icon({
  name,
  size = 20,
  color,
  weight,
  library,
  style,
}: IconProps) {
  const { colors } = useTheme();
  const resolvedColor = color || colors.textSecondary;

  const PhosphorComponent = ICON_MAP[name];

  if (!PhosphorComponent) {
    // Fallback: render a circle as placeholder for unmapped icons
    // This prevents crashes while we migrate — log in dev
    if (__DEV__) {
      console.warn(`[Icon] Unmapped icon name: "${name}" — using Circle fallback`);
    }
    return <Circle size={size} color={resolvedColor} weight="regular" style={style} />;
  }

  // Determine weight: explicit > fill names > duotone names > regular
  const resolvedWeight: IconWeight =
    weight ||
    (FILL_NAMES.has(name) ? 'fill' : undefined) ||
    (DUOTONE_NAMES.has(name) ? 'duotone' : undefined) ||
    'regular';

  return (
    <PhosphorComponent
      size={size}
      color={resolvedColor}
      weight={resolvedWeight}
      style={style}
    />
  );
}
