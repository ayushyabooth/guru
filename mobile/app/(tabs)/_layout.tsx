import { Tabs } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Platform, Animated, Easing } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MetricProvider, useMetrics } from '../../store/metric-context';
import { useTheme } from '../../contexts/ThemeContext';
import { PlasmaBlobRing } from '../../components/Rings/PlasmaBlobRing';
import { Triskelion } from '../../components/Rings/Triskelion';

/** Breathing scale animation wrapper for tab ring icons */
function TabRingIcon({ color, progress, focused, size = 26 }: {
  color: string; progress: number; focused: boolean; size?: number;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (focused) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scaleAnim, { toValue: 1.06, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(scaleAnim, { toValue: 1.0, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    } else {
      scaleAnim.stopAnimation();
      scaleAnim.setValue(1);
    }
  }, [focused]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <PlasmaBlobRing progress={progress} color={color} size={size} stroke={2.5} minimal />
    </Animated.View>
  );
}

/** Breathing Triskelion for the Home tab */
function TabHomeIcon({ focused, size = 28, catchupProgress, diveinProgress, recapProgress }: {
  focused: boolean; size?: number; catchupProgress: number; diveinProgress: number; recapProgress: number;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (focused) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scaleAnim, { toValue: 1.06, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(scaleAnim, { toValue: 1.0, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    } else {
      scaleAnim.stopAnimation();
      scaleAnim.setValue(1);
    }
  }, [focused]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Triskelion size={size} progress={{ c: catchupProgress, d: diveinProgress, r: recapProgress }} />
    </Animated.View>
  );
}

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

  // Floating glass island tab bar
  const tabBarStyle: any = {
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
    height: 64,
    borderRadius: 24,
    backgroundColor: isDark ? 'rgba(15, 20, 35, 0.80)' : 'rgba(255, 255, 255, 0.88)',
    // Border: light strokes on dark glass, dark tint on light glass
    borderWidth: 1,
    borderTopColor: isDark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(15, 23, 42, 0.08)',
    borderLeftColor: isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(15, 23, 42, 0.05)',
    borderRightColor: isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(15, 23, 42, 0.05)',
    borderBottomColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 42, 0.04)',
    // Floating shadow
    shadowColor: isDark ? '#000' : '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: isDark ? 0.5 : 0.12,
    shadowRadius: 24,
    elevation: 12,
    paddingBottom: 0,
    paddingTop: 0,
    ...(Platform.OS === 'web' ? {
      backdropFilter: 'blur(36px) saturate(200%)',
      WebkitBackdropFilter: 'blur(36px) saturate(200%)',
      boxShadow: isDark
        ? '0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)'
        : '0 4px 24px rgba(15,23,42,0.1), inset 0 1px 0 rgba(255,255,255,0.9)',
    } : {}),
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: isDark ? '#F1F5F9' : '#6366F1',
        tabBarInactiveTintColor: isDark ? '#64748B' : '#94A3B8',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabHomeIcon focused={focused} catchupProgress={catchupProgress} diveinProgress={diveinProgress} recapProgress={recapProgress} />,
        }}
      />
      <Tabs.Screen
        name="catchup"
        options={{
          title: 'Catch-up',
          tabBarIcon: ({ color, focused }) => (
            <TabRingIcon color="#38BDF8" progress={catchupProgress} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="divein"
        options={{
          title: 'Dive-in',
          tabBarIcon: ({ color, focused }) => (
            <TabRingIcon color="#EC4899" progress={diveinProgress} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="recap"
        options={{
          title: 'Recap',
          tabBarIcon: ({ color, focused }) => (
            <TabRingIcon color="#FB923C" progress={recapProgress} focused={focused} />
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
