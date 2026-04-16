import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import Icon from '../ui/Icon';
import { useTheme } from '../../contexts/ThemeContext';

// Unified tab interface that supports both simple and rich modes
export interface TabItem {
  id: string;
  label: string;
  context?: string; // For backward compatibility with FilterTabBar
  type?: 'core' | 'specialization' | 'interest'; // For FeedTabBar styling
  value?: string; // For FeedTabBar callback
}

interface UnifiedTabBarProps {
  tabs: TabItem[];
  activeTabId: string;
  onTabPress: (tabId: string, context?: string) => void;
  showIcons?: boolean; // Enable icons for FeedTabBar mode
  variant?: 'minimal' | 'rich'; // minimal = FilterTabBar style, rich = FeedTabBar style
  accentColor?: string; // Ring color for per-page theming (inferred from RingColors)
}

// Color schemes for different tab types - aligned with liquid glass design system
const TAB_COLORS = {
  core: { active: '#38BDF8', inactive: 'rgba(56, 189, 248, 0.08)' },
  specialization: { active: '#10B981', inactive: 'rgba(16, 185, 129, 0.08)' },
  interest: { active: '#EC4899', inactive: 'rgba(236, 72, 153, 0.08)' },
  default: { active: '#38BDF8', inactive: 'rgba(255, 255, 255, 0.55)' },
};

const TAB_ICONS: Record<string, string> = {
  core: 'target',
  specialization: 'star',
  interest: 'lightbulb-outline',
  default: 'clipboard-text-outline',
};

/** Convert hex color to rgba string */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export const UnifiedTabBar: React.FC<UnifiedTabBarProps> = ({
  tabs,
  activeTabId,
  onTabPress,
  showIcons = false,
  variant = 'minimal',
  accentColor,
}) => {
  const { width } = useWindowDimensions();
  const isMobile = width < 500;
  const { isDark } = useTheme();

  const getColors = (tab: TabItem, isActive: boolean) => {
    if (variant === 'rich' && tab.type) {
      const colors = TAB_COLORS[tab.type] || TAB_COLORS.default;
      return {
        accent: colors.active,
        bg: isActive ? hexToRgba(colors.active, 0.14) : hexToRgba(colors.active, 0.08),
        text: isActive ? '#FFFFFF' : '#94A3B8',
        border: isActive ? hexToRgba(colors.active, 0.5) : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
      };
    }
    const accent = accentColor || '#38BDF8';
    return {
      accent,
      bg: isActive ? hexToRgba(accent, 0.14) : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)'),
      text: isActive ? '#FFFFFF' : '#94A3B8',
      border: isActive ? hexToRgba(accent, 0.5) : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
    };
  };

  const getIcon = (tab: TabItem) => {
    if (!showIcons) return null;
    return TAB_ICONS[tab.type || 'default'];
  };

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabContainer}
        contentContainerStyle={styles.tabContentContainer}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId || tab.context === activeTabId;
          const colors = getColors(tab, isActive);
          const icon = getIcon(tab);

          // Build dynamic styles per pill
          const pillStyle: any[] = [
            styles.tab,
            variant === 'rich' && styles.tabRich,
            isMobile && styles.tabMobile,
            {
              backgroundColor: colors.bg,
              borderColor: colors.border,
            },
          ];

          // Active pill: glass treatment with accent glow + specular highlight
          if (isActive) {
            pillStyle.push({
              shadowColor: colors.accent,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.35,
              shadowRadius: 12,
            });

            if (Platform.OS === 'web') {
              pillStyle.push({
                backdropFilter: 'blur(24px) saturate(180%)',
                WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                boxShadow: `0 0 20px ${hexToRgba(colors.accent, 0.25)}, 0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.15)`,
              } as any);
            }
          } else {
            // Inactive: subtle ghost glass
            if (Platform.OS === 'web') {
              pillStyle.push({
                backdropFilter: 'blur(12px) saturate(150%)',
                WebkitBackdropFilter: 'blur(12px) saturate(150%)',
              } as any);
            }
          }

          return (
            <TouchableOpacity
              key={tab.id || tab.context}
              onPress={() => onTabPress(tab.id || tab.context || '', tab.context || tab.value)}
              style={pillStyle}
              activeOpacity={0.7}
            >
              {/* Inner specular highlight - 1px white line at top for active pill */}
              {isActive && (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 8,
                    right: 8,
                    height: 1,
                    borderRadius: 1,
                    backgroundColor: 'rgba(255,255,255,0.18)',
                  }}
                />
              )}
              {icon && <Icon name={icon} size={16} color={colors.text} style={styles.tabIcon} />}
              <Text
                style={[
                  styles.tabLabel,
                  variant === 'rich' && styles.tabLabelRich,
                  isMobile && styles.tabLabelMobile,
                  { color: colors.text },
                  isActive && styles.tabLabelActive,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

// Backward compatible exports
export const FilterTabBar: React.FC<{
  tabs: Array<{ label: string; context: string }>;
  selectedContext: string;
  onContextChange: (context: string) => void;
  accentColor?: string; // Ring color for per-page theming
}> = ({ tabs, selectedContext, onContextChange, accentColor }) => {
  const mappedTabs: TabItem[] = tabs.map((t) => ({
    id: t.context,
    label: t.label,
    context: t.context,
  }));

  return (
    <UnifiedTabBar
      tabs={mappedTabs}
      activeTabId={selectedContext}
      onTabPress={(_, context) => context && onContextChange(context)}
      variant="minimal"
      accentColor={accentColor}
    />
  );
};

export default UnifiedTabBar;

const styles = StyleSheet.create({
  wrapper: {
    height: 48,
    maxHeight: 48,
    flexDirection: 'row',
  },
  tabContainer: {
    backgroundColor: 'transparent',
    paddingVertical: 4,
    flexGrow: 0,
    flexShrink: 1,
  },
  tabContentContainer: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 10,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 2,
  },
  tabRich: {
    minHeight: 40,
  },
  tabMobile: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    minHeight: 28,
  },
  tabIcon: {
    marginRight: 8,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  tabLabelRich: {
    fontSize: 14,
    fontWeight: '600',
  },
  tabLabelMobile: {
    fontSize: 11,
  },
  tabLabelActive: {
    fontWeight: '700',
  },
});
