import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

const { width } = Dimensions.get('window');

const Shimmer: React.FC<{ style?: any }> = ({ style }) => {
  const { isDark } = useTheme();
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

  const shimmerBaseBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)';
  const shimmerOverlayBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';

  return (
    <View style={[styles.shimmerBase, { backgroundColor: shimmerBaseBg }, style]}>
      <Animated.View
        style={[
          styles.shimmerOverlay,
          { transform: [{ translateX }], backgroundColor: shimmerOverlayBg },
        ]}
      />
    </View>
  );
};

/** A single skeleton card matching DiveinArticleCard layout */
const SkeletonCard: React.FC = () => {
  const { isDark } = useTheme();
  const cardBg = isDark ? 'rgba(15,20,35,0.55)' : 'rgba(255,255,255,0.85)';
  const cardBorderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorderColor }]}>
      {/* Badges row */}
      <View style={styles.badgeRow}>
        <Shimmer style={styles.badgeSmall} />
        <Shimmer style={styles.badgeMedium} />
      </View>

      {/* Thumbnail */}
      <Shimmer style={styles.thumbnail} />

      {/* Title lines */}
      <Shimmer style={styles.titleLine1} />
      <Shimmer style={styles.titleLine2} />

      {/* Source + reading time */}
      <View style={styles.metaRow}>
        <Shimmer style={styles.metaText} />
        <Shimmer style={styles.metaDot} />
        <Shimmer style={styles.metaSmall} />
      </View>

      {/* Summary section */}
      <Shimmer style={styles.sectionLabel} />
      <View style={styles.summaryArea}>
        <Shimmer style={styles.summaryLine} />
        <Shimmer style={styles.summaryLine} />
        <Shimmer style={styles.summaryLineShort} />
      </View>

      {/* Action buttons */}
      <View style={styles.actionRow}>
        <Shimmer style={styles.actionBtn} />
        <Shimmer style={styles.actionBtn} />
      </View>
    </View>
  );
};

/** Renders a 2-column grid of 4 skeleton cards */
export const DiveinArticleSkeleton: React.FC = () => (
  <View style={styles.container}>
    {/* Section header skeleton */}
    <View style={styles.sectionHeader}>
      <Shimmer style={styles.headerLabel} />
      <Shimmer style={styles.headerCount} />
    </View>
    <View style={styles.grid}>
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </View>
  </View>
);

const cardWidth = (width - 48) / 2; // 12px margin on each side + 12px gap

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 12,
    paddingHorizontal: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  headerLabel: {
    width: 120,
    height: 18,
    borderRadius: 4,
  },
  headerCount: {
    width: 28,
    height: 20,
    borderRadius: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    width: cardWidth,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  badgeSmall: {
    width: 70,
    height: 20,
    borderRadius: 6,
  },
  badgeMedium: {
    width: 60,
    height: 20,
    borderRadius: 6,
  },
  thumbnail: {
    width: '100%',
    height: 100,
    borderRadius: 10,
    marginBottom: 8,
  },
  titleLine1: {
    height: 16,
    width: '95%',
    borderRadius: 4,
    marginBottom: 4,
  },
  titleLine2: {
    height: 16,
    width: '70%',
    borderRadius: 4,
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 10,
  },
  metaText: {
    width: 90,
    height: 12,
    borderRadius: 3,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
  },
  metaSmall: {
    width: 50,
    height: 12,
    borderRadius: 3,
  },
  sectionLabel: {
    width: 130,
    height: 14,
    borderRadius: 4,
    marginBottom: 6,
  },
  summaryArea: {
    gap: 4,
    marginBottom: 12,
  },
  summaryLine: {
    height: 12,
    width: '100%',
    borderRadius: 3,
  },
  summaryLineShort: {
    height: 12,
    width: '60%',
    borderRadius: 3,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    height: 34,
    borderRadius: 8,
  },
  shimmerBase: {
    overflow: 'hidden',
  },
  shimmerOverlay: {
    ...StyleSheet.absoluteFillObject,
    width: '50%',
  },
});
