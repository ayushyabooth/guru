import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import GuruRings from '../../components/ui/GuruRings';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MetricProvider, useMetrics } from '../../store/metric-context';
import { useTheme } from '../../contexts/ThemeContext';

function TabsWithMetrics() {
  const colorScheme = useColorScheme();
  const { isDark, colors } = useTheme();
  const { state } = useMetrics();
  const m = state.metrics;

  // Compute progress (0-1) for each ring
  const catchupProgress = Math.min(
    m.catchup.dailyProgress / Math.max(m.catchup.dailyGoal, 1), 1
  );
  const diveinProgress = Math.min(
    (m.divein.dailyProgress || m.divein.weeklyProgress) /
    Math.max(m.divein.dailyGoal || m.divein.weeklyGoal, 1), 1
  );
  const recapProgress = m.recap.status === 'completed'
    ? 1
    : m.recap.status === 'in_progress' ? 0.5 : 0;

  const tabBarStyle = isDark ? {
    backgroundColor: 'rgba(15, 20, 35, 0.85)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    ...(Platform.OS === 'web' ? {
      // @ts-ignore
      backdropFilter: 'blur(24px) saturate(200%)',
      WebkitBackdropFilter: 'blur(24px) saturate(200%)',
    } : {}),
  } : {};

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: isDark ? '#F1F5F9' : Colors[colorScheme ?? 'light'].tint,
        tabBarInactiveTintColor: isDark ? '#64748B' : undefined,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="catchup"
        options={{
          title: 'Catch-up',
          tabBarIcon: ({ color, focused }) => (
            <GuruRings
              size="tab"
              ring="catchup"
              progress={catchupProgress}
              focused={focused}
              color={color}
              dimensions={30}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="divein"
        options={{
          title: 'Dive-in',
          tabBarIcon: ({ color, focused }) => (
            <GuruRings
              size="tab"
              ring="divein"
              progress={diveinProgress}
              focused={focused}
              color={color}
              dimensions={30}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="recap"
        options={{
          title: 'Recap',
          tabBarIcon: ({ color, focused }) => (
            <GuruRings
              size="tab"
              ring="recap"
              progress={recapProgress}
              focused={focused}
              color={color}
              dimensions={30}
            />
          ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  return (
    <MetricProvider enablePolling={true} pollingInterval={60000}>
      <TabsWithMetrics />
    </MetricProvider>
  );
}
