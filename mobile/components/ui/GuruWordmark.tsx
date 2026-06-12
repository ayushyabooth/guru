import React from 'react';
import { View, Text } from 'react-native';
import GuruBlob, { BlobState } from './GuruBlob';

interface Props {
  size?: number;          // font size of the wordmark
  color?: string;         // text color (theme-aware at call site)
  state?: BlobState;      // the period is ALIVE — pass 'thinking' while working
}

/**
 * The Guru signature (identity final, founder-approved): bold lowercase
 * "guru" with the living organism as the full stop — the creature is part of
 * the name. One lockup, used identically on the Home header, the agent
 * header, and anywhere else the name appears. The period is deliberately
 * oversized (~0.62× type size) so the organism reads as a presence, not a dot.
 */
export default function GuruWordmark({ size = 24, color = '#F1F5F9', state = 'idle' }: Props) {
  const blob = Math.round(size * 0.62);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      <Text
        accessibilityRole="header"
        style={{
          fontSize: size,
          fontWeight: '800',
          letterSpacing: -0.5,
          color,
          lineHeight: Math.round(size * 1.08),
        }}
      >
        guru
      </Text>
      <View style={{ marginLeft: Math.round(size * 0.16), marginBottom: Math.round(size * 0.04) }}>
        <GuruBlob size={blob} state={state} />
      </View>
    </View>
  );
}
