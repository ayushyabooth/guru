import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';

/**
 * Category-colored gradient with large emoji overlay.
 * Used when an article has no og:image / hero image.
 *
 * BRD D.1: "Category-colored gradient with large emoji overlay."
 */

interface HeroGradientFallbackProps {
  /** Primary accent color (hex) */
  accentFrom: string;
  /** Secondary accent color (hex) — end of gradient */
  accentTo: string;
  /** Large emoji to display centered */
  emoji: string;
  /** Height of the fallback area */
  height?: number;
  /** Border radius */
  borderRadius?: number;
}

export const HeroGradientFallback: React.FC<HeroGradientFallbackProps> = ({
  accentFrom,
  accentTo,
  emoji,
  height = 180,
  borderRadius = 12,
}) => {
  const webGradient = Platform.OS === 'web'
    ? { background: `linear-gradient(135deg, ${accentFrom} 0%, ${accentTo} 100%)` }
    : undefined;

  return (
    <View
      style={[
        styles.container,
        { height, borderRadius },
        webGradient || { backgroundColor: accentFrom },
      ]}
    >
      {/* Native-only bottom half tint (approximates gradient on iOS/Android) */}
      {Platform.OS !== 'web' && (
        <View
          style={[
            styles.nativeBottomHalf,
            { backgroundColor: accentTo, borderBottomLeftRadius: borderRadius, borderBottomRightRadius: borderRadius },
          ]}
        />
      )}
      <Text style={styles.emoji}>{emoji}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  nativeBottomHalf: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
    opacity: 0.7,
  },
  emoji: {
    fontSize: 56,
    opacity: 0.85,
  },
});

export default HeroGradientFallback;
