// Phosphor-based icon component (replaces MaterialIcons fallback).

import { House, PaperPlaneTilt, Code, CaretRight } from 'phosphor-react-native';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type ViewStyle } from 'react-native';

type IconSymbolName = 'house.fill' | 'paperplane.fill' | 'chevron.left.forwardslash.chevron.right' | 'chevron.right';

const MAPPING: Record<IconSymbolName, React.ComponentType<{ size?: number; color?: string | OpaqueColorValue; weight?: string }>> = {
  'house.fill': House,
  'paperplane.fill': PaperPlaneTilt,
  'chevron.left.forwardslash.chevron.right': Code,
  'chevron.right': CaretRight,
};

/**
 * An icon component backed by Phosphor React Native.
 * Icon `name`s use the legacy SF Symbols naming for backwards compatibility.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<ViewStyle>;
  weight?: string;
}) {
  const IconComponent = MAPPING[name];
  return <IconComponent size={size} color={color as string} weight="regular" />;
}
