// Re-export from unified component for backward compatibility
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { UnifiedTabBar, TabItem } from '../shared/UnifiedTabBar';

interface FilterTab {
  id: string;
  label: string;
  type: 'core' | 'specialization' | 'interest';
  value: string;
}

interface FeedTabBarProps {
  tabs: FilterTab[];
  activeTabId: string;
  onTabPress: (tabId: string, filter: string) => void;
}

export default function FeedTabBar({ tabs, activeTabId, onTabPress }: FeedTabBarProps) {
  const mappedTabs: TabItem[] = tabs.map((t) => ({
    id: t.id,
    label: t.label,
    type: t.type,
    value: t.value,
  }));

  return (
    <View style={styles.container}>
      <UnifiedTabBar
        tabs={mappedTabs}
        activeTabId={activeTabId}
        onTabPress={(tabId, value) => onTabPress(tabId, value || '')}
        showIcons={true}
        variant="rich"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'transparent',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
});
