import React from 'react';
import { View, StyleSheet } from 'react-native';

export interface NexusSphereProps {
  size: number;
  celebrate?: boolean;
  reducedMotion?: boolean;
}

export function NexusSphere({ size }: NexusSphereProps) {
  return (
    <View
      style={[
        styles.sphere,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  sphere: {
    backgroundColor: 'rgba(255,255,255,0.35)',
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 12,
    elevation: 8,
  },
});
