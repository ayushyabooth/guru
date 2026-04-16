/**
 * HeroVolumetric — 200px-only "torus" treatment: outer rim specular + inner
 * rim shadow + subtle colored ambient glow behind the triskelion.
 *
 * Renders BEHIND the Triskelion rings. Keeps footprint minimal.
 *
 * Source of truth: Figma `Rings / Hero Volumetric Spec` (79:171).
 */

import React from 'react';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { View } from 'react-native';

export interface HeroVolumetricProps {
  size: number;
  color?: string;
}

export function HeroVolumetric({ size, color = '#EC4899' }: HeroVolumetricProps) {
  const center = size / 2;
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="heroGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <Stop offset="60%" stopColor={color} stopOpacity="0.08" />
            <Stop offset="100%" stopColor={color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {/* Background glow */}
        <Circle cx={center} cy={center} r={size * 0.48} fill="url(#heroGlow)" />
        {/* Outer rim specular (subtle white stroke) */}
        <Circle cx={center} cy={center} r={size * 0.44} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1.5} />
        {/* Inner rim shadow */}
        <Circle cx={center} cy={center} r={size * 0.14} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={1} />
      </Svg>
    </View>
  );
}

export default HeroVolumetric;
