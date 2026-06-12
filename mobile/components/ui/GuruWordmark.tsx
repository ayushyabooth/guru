import React from 'react';
import { View, Text, Platform } from 'react-native';
import GuruBlob, { BlobState } from './GuruBlob';

interface Props {
  size?: number;          // font size of the wordmark
  color?: string;         // text color (theme-aware at call site)
  state?: BlobState;      // the period is ALIVE — pass 'thinking' while working
}

/**
 * The Guru signature (identity final, founder-approved): black-weight
 * lowercase "guru" with the living organism as the full stop — the creature
 * is part of the name. One lockup, used identically on the Home header, the
 * agent header, and anywhere else the name appears.
 *
 * R13 founder feedback: the type is heavier ('900'), renders ~5% above the
 * passed size with a subtle theme-aware glow on web, and the period is a
 * full-presence organism (~0.8× type size, rendered `tight` so the body —
 * not the canvas overscan — fills the glyph box and stays vivid at 12-20px).
 */
export default function GuruWordmark({ size = 24, color = '#F1F5F9', state = 'idle' }: Props) {
  const fontSize = Math.round(size * 1.05);
  const blob = Math.round(size * 0.8);
  // subtle web-only glow derived from the text color (theme-aware)
  const glowColor = /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}55` : color;
  const webGlow =
    Platform.OS === 'web'
      ? ({ textShadow: `0 0 ${Math.max(6, Math.round(size * 0.5))}px ${glowColor}` } as any)
      : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      <Text
        accessibilityRole="header"
        style={[
          {
            fontSize,
            fontWeight: '900',
            letterSpacing: -(size * 0.015),
            color,
            lineHeight: Math.round(fontSize * 1.08),
          },
          webGlow,
        ]}
      >
        guru
      </Text>
      <View style={{ marginLeft: Math.round(size * 0.12), marginBottom: Math.round(size * 0.02) }}>
        <GuruBlob size={blob} state={state} tight />
      </View>
    </View>
  );
}
