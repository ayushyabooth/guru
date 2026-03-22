import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';

const { width } = Dimensions.get('window');

const Shimmer: React.FC<{ style?: any }> = ({ style }) => {
  const animValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(animValue, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const translateX = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-width, width],
  });

  return (
    <View style={[styles.shimmerBase, style]}>
      <Animated.View
        style={[
          styles.shimmerOverlay,
          { transform: [{ translateX }] },
        ]}
      />
    </View>
  );
};

/** A single skeleton card matching InFocusStoryboardCard layout */
const SkeletonCard: React.FC = () => (
  <View style={styles.card}>
    {/* Accent strip */}
    <Shimmer style={styles.accentStrip} />

    {/* Hero image placeholder */}
    <Shimmer style={styles.heroImage} />

    {/* Category badge */}
    <View style={styles.badgeRow}>
      <Shimmer style={styles.badge} />
    </View>

    {/* Headline */}
    <View style={styles.headlineArea}>
      <Shimmer style={styles.headlineLine1} />
      <Shimmer style={styles.headlineLine2} />
    </View>

    {/* Metadata row */}
    <View style={styles.metaRow}>
      <Shimmer style={styles.metaChip} />
      <Shimmer style={styles.metaDot} />
      <Shimmer style={styles.metaChip} />
      <Shimmer style={styles.metaDot} />
      <Shimmer style={styles.metaSmall} />
    </View>

    {/* Content summary lines */}
    <View style={styles.summaryArea}>
      <Shimmer style={styles.summaryLine} />
      <Shimmer style={styles.summaryLine} />
      <Shimmer style={styles.summaryLineShort} />
    </View>

    {/* Action buttons */}
    <View style={styles.actionRow}>
      <Shimmer style={styles.actionButton} />
      <Shimmer style={styles.actionButton} />
    </View>
  </View>
);

/** Renders 2 skeleton cards to fill initial loading state */
export const StoryboardSkeleton: React.FC = () => (
  <View style={styles.container}>
    <SkeletonCard />
    <SkeletonCard />
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingTop: 8,
  },
  card: {
    backgroundColor: 'rgba(15,20,35,0.55)',
    borderRadius: 16,
    marginHorizontal: 12,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  accentStrip: {
    height: 4,
    width: '100%',
    borderRadius: 0,
  },
  heroImage: {
    height: 180,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
  },
  badge: {
    width: 140,
    height: 28,
    borderRadius: 8,
  },
  headlineArea: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 6,
  },
  headlineLine1: {
    height: 22,
    width: '90%',
    borderRadius: 4,
  },
  headlineLine2: {
    height: 22,
    width: '60%',
    borderRadius: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 6,
  },
  metaChip: {
    width: 80,
    height: 14,
    borderRadius: 4,
  },
  metaDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  metaSmall: {
    width: 50,
    height: 14,
    borderRadius: 4,
  },
  summaryArea: {
    paddingHorizontal: 16,
    gap: 6,
  },
  summaryLine: {
    height: 14,
    width: '100%',
    borderRadius: 4,
  },
  summaryLineShort: {
    height: 14,
    width: '70%',
    borderRadius: 4,
  },
  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    height: 40,
    borderRadius: 8,
  },
  shimmerBase: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  shimmerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    width: '50%',
  },
});
