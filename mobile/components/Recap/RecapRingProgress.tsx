import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { RingColors, Typography } from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';
import Icon from '../ui/Icon';

interface RecapRingProgressProps {
  progress: number; // 0-1
  size?: number;
  insightCount?: number;
}

export default function RecapRingProgress({ progress, size = 44, insightCount = 0 }: RecapRingProgressProps) {
  const { isDark } = useTheme();
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - Math.min(progress, 1));
  const cx = size / 2;
  const cy = size / 2;

  // Theme-aware track color (matching triskelion style)
  const trackColor = isDark ? '#2A2E37' : '#D1D5DB';

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        {/* Background track — stroked ring, no fill (matches triskelion style) */}
        <Circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        {progress > 0 && (
          <Circle
            cx={cx} cy={cy} r={radius}
            fill="none"
            stroke={RingColors.recap.primary}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}
      </Svg>
      {/* Percentage text */}
      <Text style={[styles.percentText, { color: isDark ? RingColors.recap.primary : '#9A3412' }]}>
        {Math.round(progress * 100)}%
      </Text>
      {insightCount > 0 && (
        <View style={styles.insightBadge}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
            <Text style={styles.insightBadgeText}>{insightCount}</Text>
            <Icon name="star-four-points" size={8} color="#fff" />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  percentText: {
    position: 'absolute',
    ...Typography.labelSmall,
    fontWeight: '700',
    fontSize: 10,
  },
  insightBadge: {
    position: 'absolute',
    bottom: -4,
    right: -8,
    backgroundColor: RingColors.recap.primary,
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  insightBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '700',
  },
});
