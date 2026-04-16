/**
 * CausticOverlap — small additive-blend + specular spot rendered at the
 * Borromean intersection of two rings when both are filled. Makes the
 * overlap zone feel like light caustics rather than a dead overlap.
 *
 * Source: Figma `Rings / Caustic Overlap Grid` (79:116).
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';

export interface CausticOverlapProps {
  /** Center point in the parent's coordinate space. */
  a: { x: number; y: number };
  colorA: string;
  colorB: string;
  /** Size of the spot (diameter). Default 26. */
  size?: number;
  /** Render only when this is true. Default true. */
  active?: boolean;
}

export function CausticOverlap({ a, colorA, colorB, size = 26, active = true }: CausticOverlapProps) {
  if (!active) return null;
  // Use a simple radial gradient: white core → color B mid → color A edge → transparent.
  const id = `caustic-${Math.round(a.x)}-${Math.round(a.y)}`;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: a.x - size / 2,
        top: a.y - size / 2,
        width: size,
        height: size,
      }}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <Stop offset="40%" stopColor={colorB} stopOpacity="0.55" />
            <Stop offset="80%" stopColor={colorA} stopOpacity="0.25" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

export default CausticOverlap;
