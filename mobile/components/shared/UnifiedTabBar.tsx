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
        bg: isActive ? colors.active + '38' : colors.inactive,
        text: isActive ? (isDark ? '#E0F2FE' : '#0F172A') : colors.active,
        border: isActive ? colors.active + '80' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
      };
    }
    const accent = accentColor || '#38BDF8';
    return {
      bg: isActive ? `${accent}38` : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
      text: isActive ? (isDark ? '#E0F2FE' : '#0F172A') : (isDark ? '#94A3B8' : '#475569'),
      border: isActive ? `${accent}80` : (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)'),
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

          return (
            <TouchableOpacity
              key={tab.id || tab.context}
              onPress={() => onTabPress(tab.id || tab.context || '', tab.context || tab.value)}
              style={[
                styles.tab,
                variant === 'rich' && styles.tabRich,
                isMobile && styles.tabMobile,
                {
                  backgroundColor: colors.bg,
                  borderColor: colors.border,
                },
                isActive && variant === 'minimal' && styles.tabActiveMinimal,
                isActive && variant === 'minimal' && Platform.OS === 'web' && {
                  // @ts-ignore - web-only boxShadow with dynamic accent color
                  boxShadow: `0 0 16px ${(accentColor || '#38BDF8')}40, 0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.12)`,
                },
              ]}
              activeOpacity={0.7}
            >
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0,
    shadowRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
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
  tabActiveMinimal: {
    ...Platform.select({
      web: {
        backdropFilter: 'blur(16px) saturate(180%)',
        WebkitBackdropFilter: 'blur(16px) saturate(180%)',
      },
    }),
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  tabIcon: {
    marginRight: 8,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  tabLabelRich: {
    fontSize: 14,
    fontWeight: '600',
  },
  tabLabelMobile: {
    fontSize: 11,
  },
  tabLabelActive: {
    fontWeight: '600',
  },
});
