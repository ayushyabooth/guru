import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import Svg, { Circle, Line, G } from 'react-native-svg';
import {
  Spacing,
  Typography,
  BorderRadius,
  RingColors,
  getBackdropBlur,
} from '../../constants/liquidGlass';
import DarkThemeColors from '../../constants/darkTheme';
import type { KeyInsight } from '../../services/recap-service';

const { width } = Dimensions.get('window');

interface InsightConstellationProps {
  insights: KeyInsight[];
  size?: number;
  interactive?: boolean;
  showLabels?: boolean;
}

interface PositionedInsight {
  insight: KeyInsight;
  x: number;
  y: number;
}

/**
 * InsightConstellation — SVG visualization of captured insights.
 *
 * Golden dots (one per insight) are positioned in a force-directed-like layout.
 * Dots connected by luminous threads when they share source articles.
 * Tappable: tap a dot to see the full insight text.
 */
export default function InsightConstellation({
  insights,
  size = width - Spacing.xl * 2,
  interactive = true,
  showLabels = false,
}: InsightConstellationProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Position insights in a circular/force-directed layout
  const positioned = useMemo<PositionedInsight[]>(() => {
    if (insights.length === 0) return [];

    const cx = size / 2;
    const cy = size / 2;
    const radius = size * 0.35;

    if (insights.length === 1) {
      return [{ insight: insights[0], x: cx, y: cy }];
    }

    // Place insights in a circle, with slight randomization for organic feel
    return insights.map((insight, i) => {
      const angle = (i / insights.length) * Math.PI * 2 - Math.PI / 2;
      // Vary the radius based on source count for depth
      const r = radius * (0.7 + (insight.source_article_ids?.length || 1) * 0.06);
      const jitterX = (Math.sin(i * 7.3) * size * 0.04);
      const jitterY = (Math.cos(i * 5.7) * size * 0.04);

      return {
        insight,
        x: cx + Math.cos(angle) * r + jitterX,
        y: cy + Math.sin(angle) * r + jitterY,
      };
    });
  }, [insights, size]);

  // Compute connections (insights sharing source articles)
  const connections = useMemo(() => {
    const links: { from: number; to: number }[] = [];
    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        const aIds = positioned[i].insight.source_article_ids || [];
        const bIds = positioned[j].insight.source_article_ids || [];
        const shared = aIds.filter(id => bIds.includes(id));
        if (shared.length > 0) {
          links.push({ from: i, to: j });
        }
      }
    }
    // If no natural connections, connect sequentially for visual coherence
    if (links.length === 0 && positioned.length > 1) {
      for (let i = 0; i < positioned.length - 1; i++) {
        links.push({ from: i, to: i + 1 });
      }
      // Close the loop if 3+ insights
      if (positioned.length >= 3) {
        links.push({ from: positioned.length - 1, to: 0 });
      }
    }
    return links;
  }, [positioned]);

  const selectedInsight = insights.find(i => i.id === selectedId);

  if (insights.length === 0) {
    return (
      <View style={[styles.emptyContainer, { width: size, height: size / 2 }]}>
        <Text style={styles.emptyText}>No insights captured yet</Text>
        <Text style={styles.emptySubtext}>
          Insights emerge from your Socratic dialogue
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Connection lines */}
        {connections.map(({ from, to }, idx) => (
          <Line
            key={`line-${idx}`}
            x1={positioned[from].x}
            y1={positioned[from].y}
            x2={positioned[to].x}
            y2={positioned[to].y}
            stroke="rgba(251, 146, 60, 0.25)"
            strokeWidth={1}
          />
        ))}

        {/* Insight dots */}
        {positioned.map(({ insight, x, y }, idx) => {
          const isSelected = insight.id === selectedId;
          const isUser = insight.source === 'user_reflection';
          const dotSize = isUser ? 8 : 6;

          return (
            <G key={insight.id || `insight-${idx}`}>
              {/* Glow */}
              <Circle
                cx={x}
                cy={y}
                r={dotSize + 6}
                fill={isSelected ? 'rgba(251, 146, 60, 0.2)' : 'rgba(251, 146, 60, 0.08)'}
              />
              {/* Dot */}
              <Circle
                cx={x}
                cy={y}
                r={dotSize}
                fill={isUser ? RingColors.recap.primary : RingColors.recap.light}
                stroke="rgba(251, 146, 60, 0.5)"
                strokeWidth={isSelected ? 2 : 0.5}
                onPress={interactive ? () => setSelectedId(isSelected ? null : insight.id) : undefined}
              />
            </G>
          );
        })}
      </Svg>

      {/* Tooltip for selected insight */}
      {interactive && selectedInsight && (
        <TouchableOpacity
          style={styles.tooltip}
          activeOpacity={0.9}
          onPress={() => setSelectedId(null)}
        >
          <View style={styles.tooltipBadge}>
            <Text style={styles.tooltipBadgeText}>
              {selectedInsight.source === 'user_reflection' ? 'Your Insight' : 'Extracted'}
            </Text>
          </View>
          <Text style={styles.tooltipText} numberOfLines={4}>
            {selectedInsight.insight_text}
          </Text>
          {selectedInsight.filters_spanned && selectedInsight.filters_spanned.length > 0 && (
            <View style={styles.tooltipFilters}>
              {selectedInsight.filters_spanned.map((f, i) => (
                <View key={i} style={styles.tooltipFilterPill}>
                  <Text style={styles.tooltipFilterText}>{f}</Text>
                </View>
              ))}
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Show labels beneath if requested (for archive thumbnail) */}
      {showLabels && (
        <View style={styles.labelRow}>
          <Text style={styles.labelText}>
            {insights.length} insight{insights.length !== 1 ? 's' : ''} captured
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    ...Typography.labelMedium,
    color: DarkThemeColors.textTertiary,
    marginBottom: Spacing.xs,
  },
  emptySubtext: {
    ...Typography.bodySmall,
    color: DarkThemeColors.textTertiary,
    textAlign: 'center',
  },
  tooltip: {
    position: 'absolute',
    bottom: Spacing.md,
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: 'rgba(20, 25, 40, 0.92)',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.3)',
    shadowColor: '#FB923C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    ...getBackdropBlur(16),
  },
  tooltipBadge: {
    backgroundColor: 'rgba(251, 146, 60, 0.12)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.pill,
    alignSelf: 'flex-start',
    marginBottom: Spacing.xs,
  },
  tooltipBadgeText: {
    ...Typography.labelSmall,
    color: RingColors.recap.primary,
    fontWeight: '600',
  },
  tooltipText: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.textPrimary,
    fontStyle: 'italic',
  },
  tooltipFilters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  tooltipFilterPill: {
    backgroundColor: 'rgba(251, 146, 60, 0.08)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.pill,
  },
  tooltipFilterText: {
    ...Typography.labelSmall,
    color: DarkThemeColors.textSecondary,
  },
  labelRow: {
    marginTop: Spacing.sm,
    alignItems: 'center',
  },
  labelText: {
    ...Typography.labelSmall,
    color: RingColors.recap.primary,
  },
});
