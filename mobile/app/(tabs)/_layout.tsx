import { Tabs } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { MetricProvider, useMetrics } from '../../store/metric-context';
import { useTheme } from '../../contexts/ThemeContext';
import { PlasmaBlobRing } from '../../components/Rings/PlasmaBlobRing';
import { Triskelion } from '../../components/Rings/Triskelion';

/**
 * Tab-bar single-ring-per-tab icon.
 * Matches Figma `Tabs / Tab Bar States` (80:2) and `Tabs / 24px Size Spec` (80:1050).
 * Active: breathing scale + glow. Inactive: static fill, no animation.
 */
function TabRingIcon({
  color,
  progress,
  focused,
  size = 26,
}: {
  color: string;
  progress: number;
  focused: boolean;
  size?: number;
}) {
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!focused) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [focused, breath]);
  const scale = breath.interpolate({ inputRange: [0, 1], outputRange: [1.0, 1.06] });
  return (
    <Animated.View style={{ width: size, height: size, transform: [{ scale }] }}>
      <PlasmaBlobRing
        progress={progress}
        color={color}
        size={size}
        stroke={2.5}
        minimal
      />
    </Animated.View>
  );
}

/**
 * Home tab icon — Mini Triskelion (26px) per Figma 80:2 Tab Bar States.
 * B2a: Three tiny rings in Borromean layout with minimal glow.
 * Revisited from GUR-93: now uses Canvas renderer which handles the
 * small geometry much better than overlapping SVG views.
 */
function TabHomeIcon({
  focused,
  size = 28,
  catchupProgress,
  diveinProgress,
  recapProgress,
}: {
  focused: boolean;
  size?: number;
  catchupProgress: number;
  diveinProgress: number;
  recapProgress: number;
}) {
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!focused) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [focused, breath]);
  const scale = breath.interpolate({ inputRange: [0, 1], outputRange: [1.0, 1.06] });
  return (
    <Animated.View style={{ width: size, height: size, transform: [{ scale }] }}>
      <Triskelion
        size={size}
        progress={{ c: catchupProgress, d: diveinProgress, r: recapProgress }}
      />
    </Animated.View>
  );
}

function TabsWithMetrics() {
  const { isDark, colors } = useTheme();
  const { state } = useMetrics();
  const m = state.metrics;

  const catchupProgress = Math.min(m.catchup.dailyProgress / Math.max(m.catchup.dailyGoal, 1), 1);
  const diveinProgress = Math.min(
    (m.divein.dailyProgress || m.divein.weeklyProgress) / Math.max(m.divein.dailyGoal || m.divein.weeklyGoal, 1),
    1
  );
  const recapProgress = m.recap.status === 'completed' ? 1 : m.recap.status === 'in_progress' ? 0.5 : 0;

  const tabBarStyle: any = {
    backgroundColor: isDark ? 'rgba(15, 20, 35, 0.92)' : 'rgba(255, 255, 255, 0.94)',
    borderTopWidth: 1,
    borderTopColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.06)',
    height: 72,
    paddingBottom: 8,
    paddingTop: 6,
    ...(Platform.OS === 'web'
      ? {
          backdropFilter: 'blur(56px) saturate(200%)',
          WebkitBackdropFilter: 'blur(56px) saturate(200%)',
        }
      : {}),
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: isDark ? '#F1F5F9' : '#0F172A',
        tabBarInactiveTintColor: isDark ? '#64748B' : '#475569',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => (
            <TabHomeIcon
              focused={focused}
              catchupProgress={catchupProgress}
              diveinProgress={diveinProgress}
              recapProgress={recapProgress}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="catchup"
        options={{
          title: 'Catch-up',
          tabBarIcon: ({ focused }) => <TabRingIcon color="#38BDF8" progress={catchupProgress} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="divein"
        options={{
          title: 'Dive-in',
          tabBarIcon: ({ focused }) => <TabRingIcon color="#EC4899" progress={diveinProgress} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="recap"
        options={{
          title: 'Recap',
          tabBarIcon: ({ focused }) => <TabRingIcon color="#FB923C" progress={recapProgress} focused={focused} />,
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
