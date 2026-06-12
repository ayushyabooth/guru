/**
 * GlassSection — Lightweight glass surface for sections within cards (Layer 2)
 *
 * Used inside GlassCard for collapsible sections like Spotlight, Why It Matters, etc.
 * Lighter glass than the card itself, with accent-colored glow on expand.
 *
 * Layer hierarchy:
 *   Layer 0: MatrixBackground (full screen)
 *   Layer 1: GlassCard (card surface)
 *   Layer 2: GlassSection (this) — section within card
 *   Layer 3: Interactive (buttons, pills)
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import Icon from './Icon';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface GlassSectionProps {
  /** Section content (rendered when expanded) */
  children: React.ReactNode;
  /** Section header content — icon + title rendered by parent */
  headerContent?: React.ReactNode;
  /** Title text (alternative to headerContent) */
  title?: string;
  /** Icon element (alternative to headerContent) */
  icon?: React.ReactNode;
  /** Accent color for glow on expand (defaults to teal) */
  accentColor?: string;
  /** Whether section starts expanded */
  defaultExpanded?: boolean;
  /** Whether section is collapsible at all */
  collapsible?: boolean;
  /** Additional container styles */
  style?: ViewStyle;
  /** Callback when expand state changes */
  onToggle?: (expanded: boolean) => void;
  /**
   * Deep-link affordance: when provided, the header chevron becomes an
   * accent-colored "open" chevron that calls this instead of toggling.
   * The title area still toggles expand/collapse.
   */
  onNavigate?: () => void;
}

export default function GlassSection({
  children,
  headerContent,
  title,
  icon,
  accentColor = '#38BDF8',
  defaultExpanded = false,
  collapsible = true,
  style,
  onToggle,
  onNavigate,
}: GlassSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const { isDark, colors } = useTheme();

  const toggleExpand = () => {
    if (!collapsible) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = !isExpanded;
    setIsExpanded(next);
    onToggle?.(next);
  };

  // Glass surface styles
  const containerStyle: ViewStyle = {
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.5)',
    borderWidth: 1,
    borderColor: isExpanded && isDark
      ? `${accentColor}4D` // accent at ~30% opacity
      : isDark
        ? 'rgba(255, 255, 255, 0.06)'
        : 'rgba(255, 255, 255, 0.6)',
    borderRadius: 12,
    overflow: 'hidden',
    ...(isExpanded && isDark && Platform.OS === 'web' ? {
      // @ts-ignore — web-only shadow
      boxShadow: `0 0 16px ${accentColor}14`, // accent at ~8% opacity
    } : {}),
  };

  const chevronColor = isDark ? colors.textTertiary : '#6B7280';

  const header = headerContent || (
    <View style={styles.defaultHeader}>
      {icon && <View style={styles.iconContainer}>{icon}</View>}
      {title && (
        <Text style={[
          styles.title,
          { color: isDark ? colors.textPrimary : '#000000' }
        ]}>
          {title}
        </Text>
      )}
    </View>
  );

  return (
    <View style={[containerStyle, style]}>
      {collapsible ? (
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={toggleExpand}
            style={styles.headerTouchable}
            activeOpacity={0.7}
          >
            <View style={styles.headerLeft}>{header}</View>
            {!onNavigate && (
              <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={chevronColor} />
            )}
          </TouchableOpacity>
          {onNavigate && (
            <TouchableOpacity
              onPress={onNavigate}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.navChevron}
              accessibilityRole="button"
              accessibilityLabel={`Open ${title || 'section'} in the article reader`}
            >
              <Icon name="chevron-right" size={18} color={accentColor} />
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={styles.nonCollapsibleHeader}>
          <View style={styles.headerLeft}>{header}</View>
        </View>
      )}

      {(!collapsible || isExpanded) && (
        <View style={styles.content}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  navChevron: {
    paddingRight: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nonCollapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  defaultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconContainer: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  chevron: {
    fontSize: 12,
    marginLeft: 8,
  },
  content: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
});
